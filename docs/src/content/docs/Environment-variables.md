---
title: Environment variables
description: How to manage environment variables in VS Code with mise
sidebar:
  order: 20
---

## Environment variables list

Environment variables are listed in the activity bar. Click on an environment
variable to find where it's defined.

![image](https://github.com/user-attachments/assets/6c11cc6f-c7b9-4608-8ad3-701fc1d7566f)

## Loading environment variables

`mise-vscode` will automatically load all the environment variables provided by
`mise env` in the current VSCode process. (similar to the `direnv` VSCode
extension.

The variables will be provided to any newly created terminals, even if `mise` is
not activated.

![image](https://github.com/user-attachments/assets/6abe2397-05ea-4a73-a3b6-4f12406f9bec)

If the list of environment variables has changed, you might to reload the
terminal. In this case, a warning sign will be shown next to the terminal name.

![image](https://github.com/user-attachments/assets/cc905263-2b3f-4a5b-8ce9-988fbb8c8e79)

You can choose to reload open terminals automatically in the
[settings](vscode://settings/mise.updateOpenTerminalsEnvAutomatically) (off by
default). If `mise` is activated in your terminal, it's better to keep this
option turned off.

![image](https://github.com/user-attachments/assets/54c1cd26-9859-47ce-aa95-d835818a56df)
