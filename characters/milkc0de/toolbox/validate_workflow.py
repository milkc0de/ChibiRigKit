#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2026 milkc0de
# SPDX-License-Identifier: Apache-2.0
"""Enforce the machine-readable workflow contract and measured report conditions."""
import argparse,json
from pathlib import Path
from jsonschema import Draft202012Validator
from rig_contract import local_path
ROOT=Path(__file__).resolve().parents[1]

def load_contract(root):
    data=json.loads((root/'rig.workflow.json').read_text())
    Draft202012Validator(json.loads((root/'rig.workflow.schema.json').read_text())).validate(data)
    for phase in data['phases'].values():
        for file in phase['required_outputs']:local_path(root,file)
    return data

def check_rules(report,rules):
    def value(path):
        result=report
        for key in path.split('.'):
            if not isinstance(result,dict) or key not in result:raise ValueError(f'Missing measured result: {path}')
            result=result[key]
        return result
    def matches(rule):
        actual=value(rule['path']);expected=rule['equals']
        return type(actual) is type(expected) and actual==expected
    for rule in rules:
        if 'when' in rule and not matches(rule['when']):continue
        if not matches(rule):raise ValueError(f'Acceptance failed: {rule["path"]} != {rule["equals"]!r}')

def validate(root,phase=None,report=None,acceptance=None):
    contract=load_contract(root)
    if report:
        result=json.loads(local_path(root,report).read_text())
        if acceptance:check_rules(result,contract['acceptance'][acceptance])
        else:
            Draft202012Validator(json.loads((root/'rig.result.schema.json').read_text())).validate(result)
            if result['status']=='blocked' or any(i['severity']=='blocker' for i in result['issues']):raise ValueError('Agent reported a blocker; inspect the phase result JSON')
            for file in result['artifacts']:
                relative=Path(file)
                if not file.strip() or relative.is_absolute() or not relative.parts or '..' in relative.parts:
                    raise ValueError(f'Artifact must be a workspace-relative file or directory: {file}')
                artifact=local_path(root,file)
                if not (artifact.is_file() or artifact.is_dir()):raise ValueError(f'Missing reported artifact: {file}')
    if phase:
        for file in contract['phases'][phase]['required_outputs']:
            if not local_path(root,file).is_file():raise ValueError(f'Missing required output: {file}')
    return {'contract':'passed','phase':phase,'acceptance':acceptance}

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--phase',choices=['reference-planning','rigging','review']);ap.add_argument('--report');ap.add_argument('--acceptance',choices=['static','runtime']);args=ap.parse_args()
    if args.acceptance and not args.report:ap.error('--acceptance requires --report')
    print(json.dumps(validate(ROOT,args.phase,args.report,args.acceptance)))
