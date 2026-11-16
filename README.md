# Twombly for BB

Twombly adds working design frames and full page HTML captures to BB. Enable
the plugin to give agents its skill and native `twombly_run` tool. Open the
Twombly thread panel or run `bb twombly init` to start a project canvas.

The adapter calls the current npm release on the thread's execution machine.
It does not bundle or fork Twombly. The upstream integration is maintained at
[materic-inc/plugins](https://github.com/materic-inc/plugins/tree/main/twombly).
Updates apply on the next command. Active commands finish with their selected
release. BB adapter updates remain separate.

The panel opens sign-in in the client's preferred browser. Each execution
machine signs in to one Twombly account, and every thread on that machine
uses it. The sign-in callback goes to the machine's Twombly port (4747, or
`TWOMBLY_PORT` in the host daemon's environment) on the loopback address of
the computer that opens the link. For a remote execution machine, forward
that port with SSH first. If several operating-system users run BB machines
on one computer, give each user a different `TWOMBLY_PORT`. The skill gives the steps. A password manager
plugin, such as Apple Passwords, can fill the Google sign-in page. The login
endpoint is checked against Twombly 0.5.1. A future incompatible response
returns an error.

The Twombly icon in the left navigation lists every canvas that the signed-in
accounts own or that others share with them, as a grid or as lines. The BB
server stores one list for all of its users and reads it again every 10
minutes. Agents use the
`twombly_library` and `twombly_open_canvas` tools. The command line has
`bb twombly library`, `library-refresh` and `library-open`.

See [the skill](skills/twombly/SKILL.md) for commands, the programmatic contract,
data handling, machine requirements and limits. Automatic comment delivery
and embedded canvas selection events are not implemented. Agents read those
through upstream `context` and `comments` commands.
