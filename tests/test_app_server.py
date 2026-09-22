# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: MIT
"""Validate actual request payloads against the installed Codex protocol, without inference."""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from jsonschema import Draft7Validator, ValidationError

ROOT = Path(__file__).resolve().parents[1]


class AppServerProtocolTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('codex') and shutil.which('node'), 'Codex CLI and Node are required')
    def test_thread_and_turn_requests_match_installed_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            generated = subprocess.run(
                ['codex', 'app-server', 'generate-json-schema', '--out', directory],
                capture_output=True, text=True, timeout=30,
            )
            self.assertEqual(generated.returncode, 0, generated.stderr)
            captured = subprocess.run(['node', '--input-type=module', '-e', '''
                import {CodexAppServer} from './scripts/codex-app-server.mjs';
                import fs from 'node:fs';
                const server = new CodexAppServer(), requests = [];
                server.request = async (method, params) => {
                    requests.push({method, params});
                    if (method === 'thread/start' || method === 'thread/resume') return {thread: {id: 'test-thread'}};
                    server.messages.push({method: 'turn/completed', params: {
                        turn: {id: 'test-turn', status: 'completed'}
                    }});
                    return {turn: {id: 'test-turn'}};
                };
                const cwd = process.cwd(), model = 'gpt-6-astra';
                const {thread} = await server.startThread({cwd, model});
                await server.resumeThread({threadId: thread.id, cwd, model});
                await server.runTurn({cwd, model, threadId: thread.id,
                    input: [{type: 'text', text: 'Protocol validation only'}],
                    outputSchema: JSON.parse(fs.readFileSync('template/workspace/rig.result.schema.json', 'utf8'))});
                console.log(JSON.stringify(requests));
            '''], cwd=ROOT, capture_output=True, text=True, timeout=10)
            self.assertEqual(captured.returncode, 0, captured.stderr)
            requests = json.loads(captured.stdout)
            self.assertEqual([r['method'] for r in requests], ['thread/start', 'thread/resume', 'turn/start'])
            for request, filename in zip(requests, ['ThreadStartParams.json', 'ThreadResumeParams.json', 'TurnStartParams.json']):
                schema = json.loads((Path(directory) / 'v2' / filename).read_text())
                validator = Draft7Validator(schema)
                validator.validate(request['params'])
                wrong = json.loads(json.dumps(request['params']))
                if request['method'] in ('thread/start', 'thread/resume'):
                    wrong['sandbox'] = 'workspaceWrite'
                else:
                    wrong['sandboxPolicy']['type'] = 'workspace-write'
                with self.assertRaises(ValidationError):
                    validator.validate(wrong)


if __name__ == '__main__':
    unittest.main()
