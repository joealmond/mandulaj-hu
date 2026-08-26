---
publish: true
title: Copilot Tips
slug: copilot-tips
tags: []
moc: Prompt Engineering
mocSlug: prompt-engineering
accent: vermilion
---

#### Global:
- Command Palette -> GitHub Copilot Build Local Workspace Index
- Open Chat - Ctrl + Alt + I
- If answer matches public code, reformulate the question like: ..question? Dont't print code just text.
- Quick Chat(middle roll down panel): Ctrl + Shift + Alt + L
- 
#### Inline:
- Add key binding to 'GitHub Copilot Next Suggestion'
- View all suggestions (in side panel): Ctrl + Enter
- Chat in comments:
	- // Q: (question)
	- // A: (answer)
- Inline Chat: Ctrl + I
- 
Participant:
- @workspace = the whole repo
- @vscode = vscode related settings
- @terminal = any terminal related question
- 
Commands:
- /fix
- /explain
- /test (select a method and generate)
- /tests (testing infrastucture)
- /doc (inline)
- /generate

Variables:
- \#changes example1: \#changes \#file:pull_request_template.md Generate PR description using template; example2: \#changes review changes
- \#codebase example: @terminal \#codebase
- \#file: alternative \#filename.ext
- \#terminalSelection example: /explain \#terminalSelection \#file:package.json
- \#editor (obsolete)
- \#selection (obsolete)

Generate using API response (JSON):
- can generate TS interfaces from it
Reference an image:
- GPT 4o can accept image as prompt input
Ask the model for its cutoff date:
- when working with new technology i may be important
- Gemin2.0 has no cutoff date, it is continuously updated

Customize:
- https://code.visualstudio.com/docs/copilot/copilot-customization
- search for "instruction file" in VsCode GitHub Copilot settings and see that you can use **copilot-instuctions.md** file on Workspace and User level (github.copilot.chat.codeGeneration.useInstructionFiles = true to enable **copilot-instuctions.md**)