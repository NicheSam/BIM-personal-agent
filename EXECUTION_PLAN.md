# BIM Personal Agent - Startup Evaluation And Execution Plan

Date: 2026-07-09

> Historical evaluation. The implemented V0.5 scope is now defined in
> [`docs/PRODUCT.md`](docs/PRODUCT.md). Do not use the broad tool list below as
> the current build backlog.

## Conclusion

Decision: Narrow scope and build a validation MVP.

Why:

- The core technical pattern is feasible: AI client or local agent calls a tool layer, the tool layer talks to a Revit add-in, and the add-in executes Revit API commands inside Revit.
- The market already has partial alternatives: BIMGO AI-style Revit agents, Dynamo, pyRevit scripts, Autodesk Platform Services Design Automation, and open-source MCP/Revit experiments.
- The useful wedge is not "AI for all BIM". The useful wedge is a personal Autodesk/Revit agent for repetitive model operations, MEP parameter cleanup, view/sheet automation, and reusable personal skills.
- First version should avoid arbitrary AI-generated Revit code. It should let AI select from fixed, reviewed tools and fill structured parameters.

Confidence: Medium. Technical feasibility is strong; market willingness-to-pay and repeat usage need validation with real BIM users.

## Current Stage

Stage: Idea to MVP.

Reason:

- The concept and architecture are clear.
- There is already reference code and product inspiration.
- The target workflow still needs narrowing and validation before building a broad product.

## Market And Community Evidence

Strong evidence:

- Autodesk supports automation through official APIs and platforms, including Revit API patterns and Autodesk Platform Services Design Automation.
- Dynamo and pyRevit show sustained demand for Revit automation, scripting, and user-created tools.
- REVIT_MCP_study demonstrates an open-source pattern for AI client to MCP server to WebSocket to Revit add-in execution.

Medium evidence:

- BIMGO AI-style positioning shows that "natural language to BIM automation" is an active product direction.
- BIM teams already use scripts, Dynamo graphs, add-ins, and manual standards checking to reduce repetitive Revit work.

Weak or missing evidence:

- No direct interviews yet with 5 to 10 target BIM users.
- No proof yet that users would trust an AI agent to modify production Revit models.
- No pricing evidence for a personal-only version.

Important sources:

- Autodesk Platform Services Design Automation API: https://aps.autodesk.com/apis-and-services/design-automation-api
- Dynamo BIM: https://dynamobim.org/
- pyRevit: https://github.com/pyrevitlabs/pyRevit
- REVIT_MCP_study: https://github.com/shuotao/REVIT_MCP_study
- Revit API docs entry: https://www.revitapidocs.com/

## Similar Products And Alternatives

Direct competitors:

- BIMGO AI: Revit/BIM-focused AI agent concept with tool execution, knowledge base, skill library, and Revit integration.

Indirect competitors:

- Autodesk Assistant / Autodesk AI features: strong platform owner advantage, but not necessarily a personal Revit task executor.
- Autodesk Platform Services Design Automation: useful for cloud automation jobs, not an interactive in-Revit personal agent.
- Dynamo: powerful visual automation, but requires graph authoring and maintenance.
- pyRevit: powerful Revit scripting and extension platform, but not a natural-language agent by default.

Substitutes:

- Manual Revit operation.
- Office/company Dynamo graphs.
- Custom C# add-ins.
- Python scripts, pyRevit buttons, Excel schedules, and checklist-based QA.

Adjacent players:

- Autodesk.
- BIM software consultancies.
- Construction tech platforms with BIM coordination tools.
- Internal automation teams at architecture, engineering, and construction firms.

Open-source/community options:

- REVIT_MCP_study for MCP/Revit architecture.
- pyRevit for Revit automation extension patterns.
- Dynamo ecosystem for visual automation patterns.

## Differentiation Matrix

| Product | Target user | Core workflow | Pricing | Strength | User complaints/gaps | Our possible wedge |
|---|---|---|---|---|---|---|
| BIMGO AI | BIM users and organizations | Natural language to BIM task execution | Unknown from current evidence | Productized AI-BIM workflow | May be broader than personal needs | Personal, local-first, small tool set, tuned to user's workflow |
| Dynamo | Revit power users | Visual graph automation | Included with Revit ecosystem | Mature, flexible, known | Graphs can be hard to read, debug, and reuse casually | Convert repeated natural-language tasks into reusable skills |
| pyRevit | Revit automation users | Scripted extensions and buttons | Open source | Practical, flexible, community-proven | Requires scripting and extension maintenance | AI-guided tool selection and parameter filling |
| Autodesk Design Automation | Developers, platform teams | Cloud execution of design automation jobs | Platform/API pricing | Official platform, scalable | Not an in-Revit side panel for personal work | Interactive local Revit add-in first |
| REVIT_MCP_study | Developers learning MCP/Revit | MCP server to Revit API bridge | Open source | Good architecture reference | Large experimental scope, not a focused personal product | Rebuild narrower, safer, and more maintainable |

## Scorecard

| Category | Score | Rationale |
|---|---:|---|
| Problem intensity | 4 | Revit users repeatedly face slow, repetitive model cleanup, parameter, view, sheet, and MEP tasks. |
| Market evidence | 3 | Existing automation ecosystems prove demand, but personal AI-agent buying evidence is not validated. |
| Community signal | 3 | Automation communities exist around Dynamo, pyRevit, and scripts. Specific AI-agent pain evidence still needs interviews. |
| Competitive gap | 3 | Tools exist, but many require scripting or graph authoring. Gap exists for a lightweight personal agent. |
| Founder advantage | 3 | Domain interest and speed are clear. Stronger advantage depends on actual BIM workflow access and repeated user feedback. |
| Execution clarity | 4 | MVP can be narrowed to Revit side panel plus 8 to 10 safe tools plus skill storage. |

Average: 3.33 / 5.

Recommendation: Build a narrow MVP, but treat it as validation rather than a full product launch.

## Main Risks

Market risk:

- Users may like the demo but avoid using it on real production models.
- Personal tool may not have obvious willingness-to-pay unless it saves repeated hours.

Product risk:

- If the first version tries to parse arbitrary CAD drawings or generate arbitrary C# code, reliability will be poor.
- The agent needs clear previews, confirmations, and rollback-friendly behavior.

Distribution risk:

- BIM tools often spread through trust, demos, office standards, and internal champions, not generic app marketing.
- Revit add-in installation can be a friction point.

Technical and operational risk:

- Revit API commands must run through correct UI-thread patterns such as ExternalEvent and Transaction.
- Version support across Revit releases can increase maintenance cost.
- Generated code execution is unsafe unless heavily sandboxed and reviewed.

## MVP Scope

Target user:

- Individual BIM/Revit user who performs repetitive model cleanup, MEP coordination support, view/sheet preparation, or parameter management.

Problem:

- Revit users spend too much time on repetitive, rule-based operations that are too small for custom software projects but too frequent to keep doing manually.

One core workflow:

- User opens Revit side panel, enters a natural-language task, reviews the planned steps, confirms execution, and optionally saves the successful flow as a personal skill.

## In Scope For V0.1

- Revit dockable panel or modeless panel.
- Local agent service.
- Fixed tool registry, not arbitrary code generation.
- Tool calls over WebSocket or local HTTP.
- Revit add-in command executor.
- Basic project context: document name, active view, selected element ids, categories.
- 8 to 10 tools:
  - Get selected elements.
  - Get element info.
  - Query elements by category and view.
  - Set parameter value.
  - Batch rename views.
  - Apply view template.
  - Create simple pipe from two points.
  - Read connector info.
  - Save skill.
  - Run saved skill.
- Skill storage as local JSON/YAML.
- Execution preview and manual confirmation.
- Execution log with success/failure result.

## Out Of Scope For V0.1

- Full CAD drawing to BIM generation.
- Arbitrary generated C# execution.
- Cloud team collaboration.
- Organization skill marketplace.
- Multi-user permission management.
- Full AutoCAD, Civil 3D, Navisworks support.
- Automated clash resolution.
- Production-grade installer.

## Product Shape

Primary surface:

- Revit side panel with four tabs:
  - Agent: command input, planned steps, execute button, result log.
  - Tools: available reviewed Revit tools and required parameters.
  - Skills: saved workflows that can be edited and rerun.
  - Context: selected elements, active view, project standards, knowledge files.

Default execution flow:

1. User enters a task in natural language.
2. Agent converts it into a structured plan.
3. Agent maps each step to known tools.
4. User reviews the plan.
5. Revit add-in executes inside a Transaction.
6. Result is shown in the side panel.
7. User saves the workflow as a skill if it is useful.

## Technical Architecture

Recommended first architecture:

```text
Revit Dockable Panel
  -> Local Agent Service
  -> Tool Registry
  -> WebSocket or Local HTTP Bridge
  -> Revit Add-in Command Executor
  -> Revit API
```

Suggested stack:

- Revit add-in: C# / .NET Framework or version-compatible .NET for target Revit version.
- Agent service: Node.js TypeScript or Python.
- Tool protocol: MCP-compatible schema or simple local JSON-RPC first.
- Storage: local JSON/YAML for skills and settings.
- Knowledge: local Markdown folder plus selected Revit API snippets.

Safety principles:

- AI proposes plans; reviewed tools execute actions.
- Every mutating action requires explicit confirmation in V0.1.
- Prefer dry-run summaries before writes.
- Log every command, input, affected element count, and result.
- Keep a manual rollback path through Revit undo and transaction naming.

## 4-Week Execution Plan

### Week 1 - Architecture Spike

Deliverables:

- Minimal Revit add-in loads successfully.
- Local service starts and responds to health check.
- Revit panel can show connection status.
- One read-only command works: get project info or get selected element ids.

Success metric:

- From the panel, run a read-only command and see real Revit context.

### Week 2 - Safe Tool Runner

Deliverables:

- Tool schema format.
- Command executor with typed command routing.
- Tools:
  - get_selected_elements
  - get_element_info
  - query_elements
  - set_parameter
- Execution preview for mutating commands.

Success metric:

- Modify a selected element parameter after preview and confirmation.

### Week 3 - Agent And Skill MVP

Deliverables:

- Natural-language command mapped to structured plan.
- Skill save and run from local JSON/YAML.
- Basic knowledge folder with project standards and examples.
- Tools:
  - batch_rename_views
  - apply_view_template
  - create_pipe_from_points
  - get_connector_info

Success metric:

- Save one repeated workflow as a skill and rerun it successfully.

### Week 4 - Validation Prototype

Deliverables:

- Clean demo workflow.
- README and install notes.
- Sample skills.
- Error handling and execution log.
- User interview script.

Success metric:

- 3 real or realistic Revit workflows completed end-to-end in a test model.

## Validation Plan

Next 5 actions:

1. Interview 5 BIM/Revit users about last week's repetitive tasks, not hypothetical interest.
2. Pick one painful workflow from each: parameter cleanup, view/sheet prep, MEP pipe task, standards checking, selection/reporting.
3. Build only the top 2 workflows into V0.1.
4. Demo with a copy of a model, never production files first.
5. Measure whether users ask to reuse it within one week.

Success metrics:

- Activation: user completes one real task through the agent in under 5 minutes.
- Retention: user reruns a saved skill at least twice in one week.
- Time saved: user reports at least 30 minutes saved per week for one workflow.
- Trust: user is willing to run it on a copy of a real project model.
- Qualitative: user can name a specific task they want automated next.

Stop or pivot criteria:

- Fewer than 3 of 5 interviewed users have a repeated weekly task suitable for automation.
- Users prefer Dynamo/pyRevit after seeing the concept.
- The agent cannot complete a selected workflow reliably in a test model.
- The only value proposition remains "AI-powered" without measurable time saved.

## Repository Plan

Initial repository contents:

```text
README.md
EXECUTION_PLAN.md
.gitignore
```

Future structure:

```text
revit-addin/
agent-service/
skills/
knowledge/
docs/
samples/
```

## Immediate Next Build Step

Start with a technical spike:

- Create a minimal Revit add-in.
- Add a dockable panel or modeless panel.
- Add one read-only tool: get selected elements.
- Add one mutating tool: set parameter value with preview and confirmation.

Do not start with CAD-to-pipe generation. That should wait until the tool bridge and confirmation flow are stable.
