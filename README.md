# Twombly for BB

Twombly adds working design frames and full page HTML captures to BB. Enable
the plugin to give agents its skill and native `twombly_run` tool. Open the
Twombly thread panel or run `bb twombly init` to start a project canvas.

The adapter calls the current npm release on the thread's execution machine.
It does not bundle or fork Twombly. The upstream integration is maintained at
[materic-inc/plugins](https://github.com/materic-inc/plugins/tree/main/twombly).
Updates apply on the next command. Active commands finish with their selected
release. BB adapter updates remain separate.

The panel opens sign-in in the client's preferred browser. BB desktop users
can fill Google sign-in with the existing Apple Passwords toolbar action.
The user must confirm the credential on the Mac. Machine account sign-in
opens a validated link in BB. Its loopback callback requires the browser and
execution host to be the same Mac. The login endpoint is checked against
Twombly 0.5.1. A future incompatible response returns an error.

See [the skill](skills/twombly/SKILL.md) for commands, the programmatic contract,
data handling, machine requirements and limits. Automatic comment delivery
and embedded canvas selection events are not implemented. Agents read those
through upstream `context` and `comments` commands.
