# Third-Party Notices

## REVIT_MCP_study

Portions of `src/BimPersonalAgent.RevitBridge/Legacy` are derived from `shuotao/REVIT_MCP_study`, commit `cfe073951fa1e43792f9d93f015d7b82416df621`, with local Agent Gateway, queue, dynamic C# and policy changes.

The exact vendored baseline, Agent-owned overlay and source hashes are recorded in `config/upstream-lock.json`. Upstream updates are audited before integration and are not merged or published automatically.

Upstream repository: https://github.com/shuotao/REVIT_MCP_study

License declared by the pinned upstream README: MIT License. The pinned commit does not contain a standalone `LICENSE` file, so this notice records the repository, exact commit, and upstream declaration without inventing a copyright holder.

The original repository is retained separately for provenance and upstream comparison, but BIM Personal Agent does not load code or binaries from that sibling repository at runtime.

## RevitParameterInspector

The Element Lens capability was designed and implemented after studying and locally porting selected read-only data-contract and reader/builder ideas from `laytonluo/RevitParameterInspector`.

The adapted scope includes structured element context, separation of instance and type parameters, lightweight geometry and location, relationships, view/sheet context, and AI-readable output. BIM Personal Agent adds its own Gateway contract, single-target rules, bounded detail levels, token policy, readback flow, Console projection, and RevitBridge integration.

The RevitParameterInspector WPF UI, Ribbon, Excel/Markdown exporters, standalone add-in manifest, and binaries are not included. BIM Personal Agent has no runtime dependency on that repository.

Upstream repository: https://github.com/laytonluo/RevitParameterInspector

License declared by upstream: MIT License.

Copyright (c) 2026 RevitParameterInspector Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Node.js

The Windows user release bundles the official Node.js win-x64 runtime so BIM engineers do not need a separate Node.js installation.

Project: https://nodejs.org/

License: MIT License. The official Node.js `LICENSE` file is included beside `node.exe` in the release package.

## Gateway npm dependencies

The Windows user release includes production dependencies declared in `gateway/package-lock.json`. Their package metadata and license files remain inside the bundled `node_modules` tree.
