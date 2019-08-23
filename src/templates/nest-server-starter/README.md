# Starter for lenne.Tech Nest Server

This is the starter kit for the [lenne.Tech Nest Server](https://github.com/lenneTech/nest-server).

It contains everything you need to get started right away and a few code examples to help you create your own modules.

## Requirements

- [Node.js incl. npm](https://nodejs.org):  
  the runtime environment for your server

- [Git](https://git-scm.com/book/en/v2/Getting-Started-Installing-Git):  
  the version control system for your source code

- [MongoDB](https://docs.mongodb.com/manual/installation/#mongodb-community-edition-installation-tutorials)
  (or any other database compatible with [TypeORM](https://typeorm.io)):  
  the database for your objects

## 1. Install the starter kit

```bash
# Download
$ git clone https://github.com/lenneTech/nest-server-starter.git YOUR_NEW_PROJECT_DIR

# Integrate dependencies
$ cd YOUR_NEW_PROJECT_DIR
$ npm i
```

## 2. Configure your project

- `src/config.env.ts`:  
  Here you can configure the behavior and the connection of the server for the different runtime
  environments. **You should definitely adjust the secretOrPrivateKey!**

- `package.json`:  
  Customize metadata for your project.

- `README.md`:  
  Replace the file with information relevant to your project.

## 3. Start the server

`$ npm run start:dev`

## 4. Extend the server

Since the server is based on [Nest](https://nestjs.com/), you can find all information about extending your server
in the [documentation of Nest](https://docs.nestjs.com/).

We are currently working on a documentation of the extensions and auxiliary classes that the
[lenne.Tech Nest Server](https://github.com/lenneTech/nest-server) contains. As long as this is not yet available,
have a look at the [source code](https://github.com/lenneTech/nest-server/tree/master/src/core).
There you will find a lot of things that will help you to extend your server, such as:

- [GraphQL scalars](https://github.com/lenneTech/nest-server/tree/master/src/core/common/scalars)
- [Filter and pagination](https://github.com/lenneTech/nest-server/tree/master/src/core/common/args)
- [Decorators for restrictions and roles](https://github.com/lenneTech/nest-server/tree/master/src/core/common/decorators)
- [Authorisation handling](https://github.com/lenneTech/nest-server/tree/master/src/core/modules/auth)
- [Ready to use user module](https://github.com/lenneTech/nest-server/tree/master/src/core/modules/user)
- [Common helpers](https://github.com/lenneTech/nest-server/tree/master/src/core/common/helpers) and
  [helpers for tests](https://github.com/lenneTech/nest-server/blob/master/src/test/test.helper.ts)
- ...

## Further information

### Running the app

```bash
# Development
$ npm start

# Watch mode
$ npm run start:dev

# Production mode
$ npm run start:prod
```

### Test

```bash
# e2e tests
$ npm run test:e2e
```

## Planned enhancements:

- Documentation of extensions and auxiliary classes
- CLI functionalities for the efficient creation of new modules and module elements

## Thanks

Many thanks to the developers of [Nest](https://github.com/nestjs/nest)
and all the developers whose packages are used here.

## License

MIT - see LICENSE
