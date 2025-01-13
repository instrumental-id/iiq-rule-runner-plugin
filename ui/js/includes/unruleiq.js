/*
    RuleIQ is a third-party plugin available on Compass:
    https://community.sailpoint.com/t5/Plugin-Framework/RuleIQ/ta-p/139595

    It installs a snippet that loads its own modified version of CodeMirror
    on every page in the UI. This conflicts with the Rule Runner's own CM
    usage, leading to a weird situation where syntax error markers are never
    cleared. This script runs after the RuleIQ snippet but before our own
    inclusion of CodeMirror, wiping out the RuleIQ setup only on our plugin
    page.
 */

if (typeof(window.CodeMirror) !== 'undefined') {
    console.debug("Possible plugin conflict detected; clearing existing CodeMirror installation")
}

window.CodeMirror = undefined
window.clearMarks = undefined
window.editor = undefined
