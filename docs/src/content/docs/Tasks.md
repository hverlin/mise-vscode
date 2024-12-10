---
title: Tasks
description: How to manage tasks in VS Code with mise
sidebar:
  order: 30
---

## Finding tasks

### Using the mise activity bar

![image](https://github.com/user-attachments/assets/6c4243fb-4cd4-4296-a16d-9cdf31acf32e)
Click on a task to navigate to the file where the task is defined.

### Using the command palette

Using the command palette: `cmd|ctrl+shift+p` and search for
`Mise: Open task definition`.

## Running a task

You have several ways to run a task with the extension:

### Use the run task code lens action

![image](https://github.com/user-attachments/assets/f10db1fd-6e4e-4cc3-b0ff-a81d78a524e3)

Click on the run button to run the task. If some option/arguments are required,
you will be prompted to enter them.

### Use the mise activity bar

![image](https://github.com/user-attachments/assets/603f1c05-78eb-44a3-b9b8-8dfe380d1810)
Click on the run action, or use right-click -> run task

### Use the command palette

Using the command palette: `cmd|ctrl+shift+p`, search for `Mise: run task`.
Press enter.

![image](https://github.com/user-attachments/assets/28e67c2b-c1fe-492c-a06d-078d1ab001bf)

### VSCode task integration

This extension lets
[VSCode tasks](https://code.visualstudio.com/docs/editor/tasks) use `mise`
tasks. You can use `mise` tasks in your `launch.json` file. This allows you to
create your own shortcuts to run tasks

```json title=launch.json {5,6}
{
    "version": "2.0.0",
    "tasks": [
        {
            "type": "mise",
            "task": "build-my-app",
            "label": "Build my app",
            "watch": true
        }
    ]
}
```

**Supported parameters for mise tasks**

- `task`: The mise task to execute
- `watch`: Re-run the task when files change
- `miseEnv`: The
  [mise env](https://mise.jdx.dev/configuration/environments.html) to use
  (optional, will use the default miseEnv if not provided)
- `glob`: Glob pattern to watch for changes. Defaults to sources from the tasks
- `runArgs`: Arguments to pass to the task. Not used when watch is true
- `watchexecArgs`: Arguments to pass to `watchexec`. (example: `--clear`) | use
  `watchexec --help` for more information

## Create tasks

### Using the activity bar

You can create a file task or a toml task directly from the activity bar

![image](https://github.com/user-attachments/assets/58cd931f-724a-4e09-ad8a-89c039154ac5)

### Use the command palette

Using the command palette: `cmd|ctrl+shift+p`, search for
`Mise: Create File task` or `Mise: Create Toml Task`
