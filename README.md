# Patch
### ...is a bad implementation of an in-memory structured database with persistent JSON file storage.

## Guide

Patch is meant for typescript use, with types.

### Basic usage
```typescript
// This is Typescript!!
import { Database, Table } from "patchdb";
```

Let's create a database!
```typescript
const db = new Database({
  path: "./" // We need to give the database a path to save to
  autosave: 5000 // This tells the database to check for changes,
                 // and if there are any, autosave every 5 seconds
});
```

Let's also create a table!<br>
Creating a table requires a schema (aka class or something).
```typescript
class User {
  constructor(id: number, username: string, password: string) {
    this.id = id;
    this.username = username;
    this.password = password; // NOTE: THIS IS NOT HOW YOU STORE PASSWORDS!
  }
}
```

If we want to store table entries in key-value storage, and not in an array,
we should set a key parameter.<br>
You can derive this from an ID or such by using getters and setters,
otherwise you can set a plain-old unrelated key parameter.
```typescript
class User {
  id: number;
  username: string;
  password: string;

  constructor(id: number, username: string, password: string) {
    this.id = id;
    this.username = username;
    this.password = password;
  }


  get key(): string {
    return this.id.toString();
  }

  set key(value: string) {
    this.id = parseInt(value);
  }
}
```

We, of course need to create the table itself!
```typescript
const userTable = new Table<User>(
  // This indicates if we use a primary key or not.
  true,
  // This is the function that converts saved JSON data to your schema.
  json => new User(json.id, json.username, json.password),
  // This is the function that converts your schema to JSON data that's saved.
  user => ({ id: user.id, username: user.username, password: user.password })
);
```

We can add users to the user table.<br>
The table gets the key from the actual user object, so there's no need to provide it!
```typescript
userTable.add(new User(422, "john.coolguy", "super.strong.password"));
```

The following methods for tables also exist:
```typescript
Table.get(objKey)
Table.set(objKey, obj)
```

We can later get the same user from the table.<br>
Remember to use the keys you've set!
```typescript
console.log(userTable.get("422"));
// expected output: User { id: 422, username: 'john.coolguy', password: 'super.strong.password' }
```

We also need to add the table to the database, duh!!<br>
This table's name is `users`:
```typescript
db.addTable("users", userTable);
```

The following methods for databases also exist:
```typescript
Database.hasTable(tableName) // Returns a boolean value - if the table exists in the database.
Database.getTable(tableName) // Returns the table or undefined, if the table doesn't exist.
Database.deleteTable(tableName) // Deletes the table and returns it if it existed in the first place.
```

After you've created your tables and added them to the database, you can start the database.
```typescript
db.start(); // Returns: Promise<void>
```
This method will make sure the file you've provided in the database options actually exists and can be read from and written to.<br>
It will create a file for you if it doesn't exist.<br>
The method will also apply any existing data from the file to your added tables, which is why we needed the conversion functions when creating the tables.

### Advanced usage

#### Make sure to read [basic usage](#basic-usage)!

This is a very simple implementation of a database and a table class, which means you can extend it!<br>
You can make custom methods for tables by implementing BasicTable.<br>
The database just needs to know **from what** and **to what** convert the table data, and how to modify the table's data, it's accomplished with the BasicTable interface.<br>
When implementing the BasicTable interface, you also need to extend the event emitter. The database depends on that for tables to notify the database that data has changed.<br>
The only event the database is listening to from tables is `"stateChange"`. If any data has changed, emit that event so that the database can autosave if required.<br>

Example table implementation:
```typescript
class UserTable extends EventEmitter implements BasicTable<User> {
  contents: User[];
  
  constructor() {
    super();
    this.contents = [];
  }

  fromJson(obj: JSONParsable): User[] {
    return obj.map(userData => new User(userData));
  }

  toJson(): JSONParsable {
    return this.contents.map(user => user.toJson());
  }

  add(user: User): void {
    this.contents.push(user);
    this.emit("stateChange");
  }

  get(index: number): User {
    return this.contents[index];
  }

  set(index: number, user: User): void {
    this.contents[index] = user;
    this.emit("stateChange");
  }
}
```

You can extend the tables to your needs. There really isn't a limit!