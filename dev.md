This file is mostly aimed to developers.

# Building instructions

0. Install [Node.js](https://nodejs.org/) 16+
1. Install Typescript: launch `npm -g i typescript`
3. Launch `npm run build-all` in the root

You'll see some warnings about vulnerabilities. Fear not, for those are in the dev tools we are using.
If you want to be assured, run `npm audit --production` that will exclude dev stuff, and you should see something
more reassuring, like "found 0 vulnerabilities", hopefully.

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
- `npm run server-for-test` and leave it running.
- `npm test`

Alternatively you can run a development server, just be sure to load config from `tests` folder.

# Known problems
- vite's proxying server (but also CRA's) doesn't play nicely with SSE, leaving sockets open

# Guidelines

- For strings, I'm trying to use double-quotes or backticks for text that's read by the user, and single-quotes elsewhere.
- All objects that go in yaml should use snake_case.
  - Reason: we want something that is both easy for the user and maps directly in our code.
    Spaces and kebab-case don't play well with javascript and camel is less readable for the user.

# Project design

- At the moment the admin-panel was designed to be completely separated from the "user" frontend 
  to keep the latter smaller and to allow alternative frontends creation without having to deal with
  the complexity of the admin-panel.

  Of course this comes with a price to pay on the programmer's side, more work to do.
