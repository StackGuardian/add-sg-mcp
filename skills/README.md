# StackGuardian skills

`@stackguardian/mcp-wizard` installs six skills next to the StackGuardian MCP server. A skill teaches your coding agent how to carry out a StackGuardian task step by step. With a skill, the agent looks up your workflow groups, templates and connectors instead of guessing. It shows you the values it is about to use, and it confirms a summary with you before it creates or changes anything.

- [How the pieces fit](#how-the-pieces-fit)
- [StackGuardian terms you'll see](#stackguardian-terms-youll-see)
- [Which skill do I need?](#which-skill-do-i-need)
- [The skills](#the-skills): [sg-create-workflow](#sg-create-workflow) · [sg-update-workflow](#sg-update-workflow) · [sg-upgrade-workflow](#sg-upgrade-workflow) · [sg-create-stack](#sg-create-stack) · [sg-create-policy](#sg-create-policy) · [sg-manage-secrets](#sg-manage-secrets)
- [Staying in control](#staying-in-control)
- [Updating and removing the skills](#updating-and-removing-the-skills)
- [For contributors](#for-contributors)

## How the pieces fit

```
 You ── ask in plain language ──▶ Coding agent ── follows ──▶ Skill (the playbook)
                                       │
                                       └── calls tools on ──▶ StackGuardian MCP server ──▶ Your StackGuardian organization
```

- **The StackGuardian MCP server** gives your agent tools for your StackGuardian organization, such as searching workflows, reading run logs, creating a workflow or storing a secret.
- **A skill** is a playbook for one task. It tells the agent which tools to use, in what order, and what to ask you along the way.
- **You** make the decisions. The agent brings you the options and you pick.

Not set up yet? Run `npx @stackguardian/mcp-wizard` and follow the [README](../README.md#install). It installs the server and all six skills. Then restart your agent.

## StackGuardian terms you'll see

| Term               | What it means                                                                                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Workflow**       | One deployment of infrastructure code (Terraform, OpenTofu, or a pipeline of custom steps such as Ansible or Helm), together with its settings and run history.                                                                                                                                     |
| **Run**            | One execution of a workflow, for example a plan or an apply.                                                                                                                                                                                                                                        |
| **Workflow group** | A folder for workflows. Groups can be nested, such as `prod/eu-central-1`.                                                                                                                                                                                                                          |
| **Template**       | A reusable blueprint for a workflow from the StackGuardian library. Each version is a **revision**, and a revision is either published or a draft.                                                                                                                                                  |
| **Stack**          | Several workflows created together from a stack template, which also sets the order they run in (for example network, then security group, then VM).                                                                                                                                                |
| **Policy**         | Rules that check your infrastructure changes, such as "S3 buckets must be private". When a rule fails, the run is blocked, gets a warning, or waits for approval. Rules can be written in [Tirith](https://github.com/StackGuardian/tirith), StackGuardian's open-source policy engine, or in Rego. |
| **Connector**      | Saved access to a cloud account or a git provider. Workflows use a cloud connector to deploy and a git (VCS) connector to read private repositories.                                                                                                                                                |
| **Secret**         | A value kept in the StackGuardian vault, such as a token, password or SSH key. Workflows refer to it by name, and its value can't be read back.                                                                                                                                                     |

## Which skill do I need?

| I want to…                                                                                        | Skill                                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Deploy a template from the StackGuardian library                                                  | [`sg-create-workflow`](#sg-create-workflow)                                                                                  |
| Deploy Terraform or OpenTofu from my own git repository                                           | [`sg-create-workflow`](#sg-create-workflow)                                                                                  |
| Run an Ansible playbook, Helm chart, Kubernetes manifest or CloudFormation template as a workflow | [`sg-create-workflow`](#sg-create-workflow)                                                                                  |
| Change a workflow's variables, schedule, approvals, connector or sizing                           | [`sg-update-workflow`](#sg-update-workflow)                                                                                  |
| Move a workflow to a newer (or older) template revision                                           | [`sg-upgrade-workflow`](#sg-upgrade-workflow)                                                                                |
| Deploy several related workflows together                                                         | [`sg-create-stack`](#sg-create-stack)                                                                                        |
| Block, warn on, or require approval for risky changes                                             | [`sg-create-policy`](#sg-create-policy)                                                                                      |
| Store, rotate or delete a token, password or key                                                  | [`sg-manage-secrets`](#sg-manage-secrets)                                                                                    |
| Manage StackGuardian itself as Terraform code                                                     | The Terraform authoring skills in [StackGuardian/skills](https://github.com/StackGuardian/skills#terraform-authoring-skills) |

### Starting a skill

- **Just ask.** Describe what you want in your own words. Your agent picks the skill that matches.
- **Or name it.** In Claude Code, type the skill as a slash command, such as `/sg-create-workflow`.
- **No IDs needed.** You don't have to know group, template, connector or secret IDs. The agent looks them up and lets you choose from a list.

## The skills

These skills use the StackGuardian MCP server and act on your StackGuardian organization.

### sg-create-workflow

**Deploy something new**, either from a template in the StackGuardian library or from your own git repository.

**Try saying**

- "Deploy the S3 bucket template from the StackGuardian library into the `dev` workflow group."
- "Create a workflow for the Terraform in `github.com/my-org/infra`, folder `envs/staging`, branch `main`."
- "Set up a workflow that runs our Ansible playbook as a custom step."
- "Create an OpenTofu workflow from our repo that needs approval before every apply."

<details>
<summary><b>What the agent will ask you, step by step</b></summary>

1. **Where the code comes from:** the template library or your own git repository.
2. **The source details.**
   - Template: which template and which revision. Draft revisions are labeled, because a draft can still change and isn't meant for production.
   - Git: the repository URL, branch and folder, and whether the repository is public or private. For a private repository, you pick the git connector that has access.
3. **Where it lives:** the workflow group (find one by name, create a new one, or browse in the dashboard), plus a name, description and tags.
4. **Cloud access and variables:** which cloud connector to deploy with, and any environment variables, either as plain text or taken from a secret.
5. **Custom steps** (for Ansible, Helm and similar): which step templates to run, in what order, and the inputs for each step.
6. **Template inputs:** every input with the value that will be used, including defaults. You confirm or change each one.
7. **Optional extras**, only if you want them: approval before apply, scheduled runs, notifications and webhooks after a run, starting another workflow when this one finishes, a private runner, caching, and CPU or memory size.
8. **A summary to confirm.** Only then does the agent create the workflow.

</details>

**Good to know**

- You always see a template's defaults before anything is created. An input you leave alone still deploys its default value, so read the list.
- An approval gate has two parts: whether runs pause before apply, and who can release them. The agent asks for both and reads the result back in plain words, for example "any one of these two people can approve".
- Ansible, Helm, Kubernetes and CloudFormation run as **custom** workflows built from step templates in the library.

### sg-update-workflow

**Change an existing workflow's settings.** Only what you ask to change is changed; everything else stays as it is.

**Try saying**

- "Add a nightly 2 AM schedule to `prod-vpc`."
- "Turn on drift detection for `prod-vpc`, checking every six hours."
- "Add the environment variable `DB_PASSWORD` to `prod-vpc`, using the `prod-db-password` secret."
- "Require approval from alice@example.com or bob@example.com before `prod-vpc` applies."
- "`prod-vpc` runs keep running out of memory. Give them 4 GB."
- "Pin `prod-vpc` to Terraform 1.6.2."

<details>
<summary><b>What happens, step by step</b></summary>

1. The agent finds the workflow and confirms it's the one you mean.
2. You say what to change: description, tags, connector, environment variables, Terraform options, custom steps, approvals, runner, schedules, notifications, cache, sizing, template inputs, or whether the workflow is active.
3. Some settings are saved as a whole list: tags, schedules, approvers, custom steps, runner, cache and GitHub triggers. For those, the agent reads the current list first and sends it back with your change, so adding one tag doesn't remove the others. It tells you when this applies.
4. You confirm a summary, and the agent updates the workflow.

</details>

**Good to know**

- To move a workflow to another template revision, use [`sg-upgrade-workflow`](#sg-upgrade-workflow) instead.
- Removing an environment variable isn't supported by the skill yet. Remove it in the StackGuardian dashboard.

### sg-upgrade-workflow

**Move a workflow to a different template revision**, with a preview of every change before anything is applied.

**Try saying**

- "Upgrade `prod-vpc` to the latest revision of its template."
- "What would change if I moved `prod-vpc` to revision 5 of its template?"
- "Roll `prod-vpc` back to the previous template revision."

<details>
<summary><b>What happens, step by step</b></summary>

1. The agent finds the workflow, then the revision to move to. Draft revisions are labeled.
2. You choose how to upgrade:
   - **Keep my settings:** take the new template code and keep the changes you made on this workflow.
   - **Reset to the template:** take the new revision's defaults and drop this workflow's own changes.
3. **Preview (dry run).** The agent shows how many settings would be added, changed or removed, with the before and after for each. Nothing changes yet.
4. **Review four things**, every time: template inputs (with the new revision's defaults), environment variables, the cloud connector, and custom step settings.
5. You confirm, and the agent applies the upgrade.

</details>

**Good to know**

- An upgrade resets scheduled runs and CPU and memory sizing to the template's values. The agent checks what you have today and offers to keep it.
- A run that is still in progress blocks the upgrade. Wait for it to finish or cancel it.
- If your organization isn't subscribed to the target template, the upgrade fails until you subscribe to it.

### sg-create-stack

**Deploy several related workflows together** from a stack template. The template sets which workflows are in the stack and the order they run in.

**Try saying**

- "Find a stack template that sets up a VPC, a security group and an EC2 instance."
- "Create a stack from that template in the `staging` group, and deploy every workflow with our AWS staging connector."
- "Create the stack, but give the EC2 workflow a larger instance type than the default."

<details>
<summary><b>What happens, step by step</b></summary>

1. You pick a stack template and revision. The agent lists the workflows inside it.
2. You choose the workflow group, a stack name, a description and tags.
3. You set the cloud connector and environment variables, either for the whole stack or for individual workflows.
4. The agent walks through **each workflow's inputs, one workflow at a time**, showing the value that will be used. Inputs that come from another workflow's output, such as a VPC ID from the VPC workflow, are filled in automatically, and the agent tells you where each one comes from.
5. You confirm a summary, and the agent creates the stack.

</details>

**Good to know**

- **Creating a stack doesn't deploy anything.** To deploy, run the stack's apply action from the dashboard link the agent gives you, or ask the agent to run the workflows in order.
- Stacks are always built from a template. To deploy your own repository, use [`sg-create-workflow`](#sg-create-workflow).
- If creation fails partway, some workflows may already exist. The agent checks what was created before it tries again.

### sg-create-policy

**Add a guardrail** that checks infrastructure changes and blocks them, warns on them, or waits for approval.

**Try saying**

- "Block any deployment in the `prod` group that makes an S3 bucket public."
- "Warn when the estimated monthly cost of an EC2 instance goes over $100."
- "Require approval from the platform team before any change deploys through our production AWS connector."
- "Use the Rego policies in `github.com/my-org/policies` for every workflow in `prod`."
- "Add the `staging` group to the `no-public-s3` policy."

<details>
<summary><b>What happens, step by step</b></summary>

1. **What to check.** The agent offers, in this order:
   - a ready-made policy template from the StackGuardian library, if one fits;
   - a rule the agent writes for you in Tirith, described back to you in plain words before it's saved;
   - your own git repository of Rego or Tirith policies.
2. **What happens when a rule fails:** block the deployment, warn, or pause for approval.
3. **Where it applies:** the whole organization, chosen workflow groups, specific workflows, or every workflow that deploys through a chosen cloud connector.
4. **Who can approve**, if any rule pauses for approval, and how many approvals are needed.
5. **A name**, description and tags. Then the agent creates the policy.

</details>

**Good to know**

- A policy for the whole organization covers every workflow and stack, so the agent asks you to confirm that explicitly.
- You can change a policy later: its scope, rules, approvers or name. Just ask, as in the last example above.
- An approval on a workflow's last step is skipped, so workflows that only run a plan never pause for it.

### sg-manage-secrets

**Store, rotate or delete secrets**, and use them in workflows.

**Try saying**

- "Store a GitHub token as a secret called `GITHUB_TOKEN`."
- "Rotate the `DB_PASSWORD` secret."
- "Delete the `OLD_API_KEY` secret. Which workflows still use it?"
- "Store this API token and add it to `prod-vpc` as the `API_TOKEN` environment variable."

<details>
<summary><b>What happens, step by step</b></summary>

- **Create:** you choose a name (letters, digits, `_` and `-`; upper and lower case count as different names) and paste the value once. The agent stores it and gives you two ways to use it:
  - `/secrets/<name>` for a workflow environment variable or a git credential;
  - `${secret::<name>}` inside a text value, such as a template input or a webhook secret.
- **Rotate:** the agent finds the secret and saves the new value. Workflows use the new value from their next run; runs already in progress keep the old one.
- **Delete:** the agent first lists the workflows that mention the secret and tells you what it couldn't check. It deletes only after you say yes. Deleting is permanent.

</details>

**Good to know**

- A secret's value can't be read back, by the agent or anyone else. You can only replace it.
- The value you paste passes through your conversation with the agent. Follow your organization's rules for sharing credentials with AI tools.
- Rotating a secret needs an admin or ops role in StackGuardian.

## Staying in control

- **The guided skills act on your real StackGuardian organization.** Most agents ask before each tool call; read what the agent is about to do before you approve it.
- **The agent has only the access your connection gives it.** With the default sign-in, that's the organization and roles you approved in the browser.
- **Nothing is created without a summary first.** Every guided skill ends with a plain-language summary for you to confirm.
- **Defaults are never hidden.** Template inputs are shown with the values that will be used, even when you don't need to change them.

## Updating and removing the skills

- **Update:** run `npx @stackguardian/mcp-wizard@latest`, or the install script again. Each run refreshes the skills.
- **Check:** `npx @stackguardian/mcp-wizard status` shows which agents have the skills.
- **Skip:** `npx @stackguardian/mcp-wizard --skip-skills` installs the server without them.
- **Remove:** `npx @stackguardian/mcp-wizard remove` takes the server and the skills out of your agents.

The skills are copied to `~/.agents/skills/` and linked into each agent's own skills folder (`~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills`, …). Mastra Code and MCPorter have no skills support, so they get the server only.

Looking for skills that write Terraform code for StackGuardian? They're in [StackGuardian/skills](https://github.com/StackGuardian/skills#terraform-authoring-skills).

## For contributors

Each directory here is an [Agent Skill](https://agentskills.io): a `SKILL.md` with `name` and `description` frontmatter, where `name` equals the directory name. The installer copies the skills listed in `SG_SKILL_NAMES` in `src/sg/skills.ts`, so add a new skill there too.
