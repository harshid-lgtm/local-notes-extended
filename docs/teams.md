# Working with your team

With a [team server](self-hosting.md), Local Notes becomes a shared, real-time wiki for your team — and every person keeps a private space.

## Connect

- **Desktop app:** vault menu (top-left) → **Connect to a team server**, enter its address, then sign in.
- **Browser:** open your server's address, e.g. `https://notes.yourcompany.com`.

The first person to sign up on a new server becomes its admin. After that, people join with an **invite link**.

## Private and shared

The sidebar shows **Private** — pages only you can see unless you share them — then **Shared with me**, then each team workspace you belong to. Workspace members see every page in it, except pages set to *Only people invited*.

You can belong to as many workspaces as you like, so a company can have one per team (Engineering, Sales, Leadership…). Create one with **New workspace** at the bottom of the sidebar.

| Role | Can |
| --- | --- |
| Owner | Everything, plus add or remove people, change roles, rename or delete the workspace |
| Editor | Create, edit, move and delete pages; comment |
| Viewer | Read pages and comments |

## Add people to a workspace

Open a workspace's `•••` menu → **Share & members**. Workspace owners can:

- **Add people already on this server**: type a name or email, pick a role and click **Add**. They're notified and the workspace appears in their sidebar straight away.
- **Invite with a link** for people who don't have an account yet. Links work for 14 days.
- Change anyone's role, or remove them with **×**. Removing someone disconnects them from the workspace's pages immediately.

## Share a page with selected people

Click **Share** at the top of any page — including pages in your private space.

- **Invite people**: type a name or email, choose **Can edit** or **Can view**, and click **Invite**. You can pick several people at once. They're notified, and the page (with its subpages) appears under **Shared with me** in their sidebar if they aren't in that workspace.
- **Change or remove access**: use the role menu or **×** next to a person. Changes apply live — someone viewing the page is switched to read-only or taken off it.
- **General access** (team pages only): choose **Everyone in *workspace*** or **Only people invited**. Restricted pages, and their subpages, are hidden from everyone else in the workspace — including the sidebar, search, links, graph and Ask AI. A lock appears next to them in the sidebar.
- Subpages inherit access from their parent; the dialog shows where someone's access comes from.

The page's creator and workspace owners can change who has access. Anyone a page is shared with can remove themselves from the same dialog.

## Move pages between workspaces

Use a page's `•••` menu → **Move to…** to move it (and its subpages) to another workspace or to your private space — for example, to share a private draft with the team. History and comments move with it.

## Edit together

Open the same page as a teammate and you'll see their avatar at the top and their named cursor as they type. Changes merge automatically, even if your connection drops for a moment — the status shows **Live**, **Connecting…** or **Offline**.

## Comments and mentions

Select text and click **Comment** (`Ctrl Alt M`). Type `@` to mention someone — they get a notification. Reply, **resolve** threads when done, and switch between open and resolved comments in the comments panel.

## Inbox

Mentions, replies, pages shared with you and workspaces you're added to arrive in **Inbox** with a badge. Click one to jump straight to the comment.

## Version history

Click the clock icon. A version is saved automatically every 10 minutes while people edit, and you can **Save a named version** any time. Click a version to preview it and **Restore** it — the current text is saved as a version first, so nothing is lost.

## Trash

Deleted team pages go to the workspace **Trash** (workspace `•••` menu), where anyone with edit access can restore them.

## AI

If the server admin has turned AI on, everyone can use the [AI assistant](ai.md) without their own key.
