This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Supabase MCP (Claude Code)

Claude Code reaches the production database (project ref `okvjdpqnqyrzpbaneivu`, FL CRM) through two MCP servers:

| Server | Connects as | Use |
|---|---|---|
| `supabase-flcrm-ro` | `supabase_read_only_user` (`read_only=true`) | Every read. No approval prompt. |
| `supabase-flcrm` | `postgres` (superuser, bypasses RLS and role checks) | Writes and schema changes only. `execute_sql` and `apply_migration` always prompt. |

The config is per machine: it lives in local scope in `~/.claude.json` and is not committed. The permission gate lives in `.claude/settings.local.json`, which is gitignored. Rules for using these servers are in `CLAUDE.md` under "Database access (Supabase MCP)".

### Setup

1. Add both servers:

   ```bash
   cd ~/Dev/FL/fully-launched-crm
   claude mcp add --scope local --transport http supabase-flcrm "https://mcp.supabase.com/mcp?project_ref=okvjdpqnqyrzpbaneivu&features=database,docs,debugging,development"
   claude mcp add --scope local --transport http supabase-flcrm-ro "https://mcp.supabase.com/mcp?project_ref=okvjdpqnqyrzpbaneivu&read_only=true"
   ```

2. In Claude Code, run `/mcp` and Authenticate each server with the Supabase account in the Fully Launched org.

3. Create `.claude/settings.local.json`:

   ```json
   {"permissions":{"ask":["mcp__supabase-flcrm__execute_sql","mcp__supabase-flcrm__apply_migration"],"deny":["mcp__claude_ai_Supabase_Grad_Gig"]}}
   ```

4. Run `/permissions` in Claude Code and confirm both ask rules and the deny rule are listed.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
