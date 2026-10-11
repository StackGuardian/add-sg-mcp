# StackGuardian agent skills

These skills are installed by `add-sg-mcp` next to the StackGuardian MCP
server. Each directory is an [Agent Skill](https://agentskills.io): a
`SKILL.md` with `name`/`description` frontmatter whose `name` equals the
directory name.

| Skill                 | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `sg-create-workflow`  | Guided creation of a workflow with the `create_workflow` tool           |
| `sg-update-workflow`  | Guided settings changes with `update_workflow`                          |
| `sg-upgrade-workflow` | Guided template-revision upgrade with `update_workflow` (dry-run first) |

