import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "vscode-tracer" is now active!');
    const disposable = vscode.commands.registerCommand(
        "vscode-tracer.openHistoryView",
        () => {
            vscode.window.showInformationMessage("Hello World from tracer!");
        },
    );

    context.subscriptions.push(disposable);
}
export function deactivate() {}
