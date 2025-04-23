This file is mostly aimed to developers.

# Building instructions

0. Install [Node.js](https://nodejs.org/) 18.15+
   - 18.15 is required for statfs function 
1. Install Typescript: launch `npm -g i typescript`
3. Launch `npm run build-all` in the root

At this stage you have a javascript output. For binary files you'll also have to `npm run dist-bin`.

You could instead run *dist* to run both *build-all* & *dist-bin*.

## Troubleshooting

- If you get error "Rollup failed to resolve import "@mui/icons-material/..."
  - edit `admin/src/vite.config.ts` and remove the `vitePluginImport` part

# Dev environment

0. `npm install`
1. `npm run watch-server-proxied` and leave it running. It will serve server stuff plus will proxy frontend and admin files.
2. `npm run start-frontend` and leave it running. It will serve on port 3005.
3. `npm run start-admin` and leave it running. It will serve on port 3006

If you don't want this proxying version, you can use `npm run watch-server` but after both frontend and admin have
been built, so their files are available in `dist` folder.

# Tests

To run tests
- `npm run build-all`
- `npm run test-with-server` (backend tests)
- `npx playwright test` (these are UI tests)

# File organization

The project is roughly divided in Server + Frontend + Admin, where Frontend is a web interface intended to access
shared files, while Admin is the web interface for configuration/administration.  
Server resides in the project's root, with its "src" folder, while Frontend and Admin are inside folders "frontend"
and "admin" respectively, each with its own "src" folder within. 

Additionally, you have the following folders:
- mui-grid-form: a lib used by Admin to easily build forms  
- plugins: a collection of plugins that are pre-installed 
- shared: code shared between Frontend and Admin
- tests: automated tests with related resources
- e2e: automated UI tests (first execution will give an error because it's creating screenshots)

# Known problems
- vite's proxying server (but also CRA's) doesn't play nicely with SSE, leaving sockets open
- automatic tests 'upload.interrupted' is subject to race conditions and may occasionally fail

# Guidelines

- For strings, I'm using double-quotes for text that's read by the user, and single-quotes elsewhere. Backticks can be any. 
- All keys that go in yaml should use snake_case.
  - Reason: we want something that is both easy for the user and maps directly in our code.
    Spaces and kebab-case don't play well with javascript and camel is less readable for the user.
- API names should start with get_ if and only if they provide information without making changes.
- All parameters that contain a *uri* should have a name that starts with `uri`.
- React parts don't use JSX. I used JSX for a couple of years before deciding that it is not good enough to pay the
  price of using an extra language that is also necessary to switched in and out multiple times when stuff is nested.  
- All calls to async functions that don't want/need to "await" should be using the "void" operator to clarify it's 
  intentional and not that you just forgot to await. Don't confuse the void operator with the void type.

# Project design

- At the moment the admin-panel was designed to be completely separated from the "user" frontend 
  to keep the latter smaller and to allow alternative frontends creation without having to deal with
  the complexity of the admin-panel.

  Of course this comes with a price to pay on the programmer's side, more work to do.
