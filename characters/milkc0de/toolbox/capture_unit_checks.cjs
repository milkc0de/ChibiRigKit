// SPDX-FileCopyrightText: 2026 milkc0de
// SPDX-License-Identifier: Apache-2.0
// Compatibility entry point for the local check command, not a legacy format parser.
require('node:child_process').execFileSync(process.execPath,['--test','tests/player/motion.test.cjs','tests/player/axis-gains.test.cjs','tests/player/app-boot.test.cjs'],{cwd:require('node:path').resolve(__dirname,'../../..'),stdio:'inherit'});
