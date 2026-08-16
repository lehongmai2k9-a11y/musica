# Music Chapter Library V2

## Stack
- Frontend: HTML + CSS + JavaScript ES modules
- Database/Auth/Storage: Supabase
- Hosting: Netlify (recommended)
- Runs from Visual Studio Code

## Setup

### 1. Create Supabase project
Go to https://supabase.com and create a project.

### 2. Run database SQL
Supabase Dashboard -> SQL Editor -> New query.
Copy everything from `schema.sql` and Run.

### 3. Create Storage buckets
Supabase -> Storage -> New bucket:
- `covers` -> Public
- `music` -> Public

### 4. Create your admin account
Supabase -> Authentication -> Users -> Add user.
Use your email/password.

### 5. Put Supabase keys in supabase.js
Supabase Dashboard -> Project Settings -> API.
Copy:
- Project URL
- Publishable/anon key

Put them here:
```js
export const SUPABASE_URL = "...";
export const SUPABASE_ANON_KEY = "...";
```

Do NOT put the service_role/secret key in frontend code.

### 6. Run locally
Open the folder in VS Code.
Use Live Server on `index.html`.

Because this project uses ES modules, Live Server is recommended.

### 7. Test admin
Open:
`http://127.0.0.1:5500/admin.html`

Log in with the Supabase user.

Create Story -> Create Chapter -> + Music -> upload audio/link.

### 8. Deploy
Upload/push the project to GitHub and connect the repository to Netlify.
Netlify will serve `index.html` and `admin.html`.

## Important V2 behavior
- Public visitors can read stories/chapters/tracks.
- Authenticated users can write/delete according to the SQL policies.
- For a single-owner website, only create your own admin account.
- The frontend uses the public/publishable anon key. This key is meant to be exposed in browser code when RLS is configured correctly.
