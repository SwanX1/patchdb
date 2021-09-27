import { EventEmitter } from "events";
import { chmod, constants as fsconstants, ensureFile, stat, writeFile } from "fs-extra";
import { FileHandle, open } from "fs/promises";
import { checkFileAccess, getCheckBitmap as checkBitmap, JSONObject, JSONParsable, mapObject } from "./Util";

export interface DatabaseOptions {
  path: string;
  /** 
   * Autosave interval. If set to 0, database will not autosave.
   * @default 0
   */
  autosave?: number;
}

export type SchemaObj<HasKey extends boolean = boolean> = HasKey extends true ? { key: string } : {};

/**
 * This interface may seem confusing, however it is very simple.
 * If the property `hasPrimaryKey == false`, `content` is an array
 * of `ContentSchema`, if `hasPrimaryKey == true`, `content` is an
 * object with string keys, and `ContentSchema` values, and the
 * `ContentSchema` values are objects that contain a key called `key`,
 * which, obviously, stores the key.
 */
export class Table<ContentSchema extends {} | { key: string } = {}> extends EventEmitter {
  private content: { [key: string]: ContentSchema } | ContentSchema[];
  private schemaFromJson: (obj: JSONObject) => ContentSchema;
  private schemaToJson: (obj: ContentSchema) => JSONObject;
  private shouldUseCache: boolean = false;
  private cachedContentJson?: JSONObject | JSONParsable[];

  constructor(hasPrimaryKey: boolean, schemaFromJson: (obj: JSONObject) => ContentSchema, schemaToJson: (obj: ContentSchema) => JSONObject) {
    super();
    if (hasPrimaryKey) {
      this.content = {};
    } else {
      this.content = [];
    }
    this.schemaFromJson = schemaFromJson;
    this.schemaToJson = schemaToJson;
  }

  public add(obj: ContentSchema): void {
    if (Array.isArray(this.content)) {
      this.content.push(obj);
    } else {
      this.content[(obj as { key: string }).key] = obj;
    }
    this.shouldUseCache = false;
    this.emit("stateChange");
  }

  public get(key: string | number): ContentSchema | undefined {
    if (typeof key === "number") {
      return (this.content as ContentSchema[])[key];
    } else {
      return (this.content as { [key: string]: ContentSchema })[key];
    }
  }

  public set(key: string | number, obj: ContentSchema | null): void {
    if (obj === null) {
      delete (this.content as any)[key];
    } else {
      (this.content as any)[key] = obj;
    }
    this.emit("stateChange");
  }

  public toJson(): JSONObject | JSONParsable[] {
    if (!this.shouldUseCache || typeof this.cachedContentJson === "undefined") {
      if (Array.isArray(this.content)) {
        this.cachedContentJson = this.content.map(this.schemaToJson);
      } else {
        this.cachedContentJson = mapObject(this.content, this.schemaToJson);
      }
      this.shouldUseCache = true;
    }
    return this.cachedContentJson;
  }


  public fromJson(obj: JSONObject[]): ContentSchema[];
  public fromJson(obj: { [key: string]: JSONObject }): { [key: string]: ContentSchema };
  public fromJson(given: { [key: string]: JSONObject } | JSONObject[]): { [key: string]: ContentSchema } | ContentSchema[] {
    if (Array.isArray(given)) {
      return given.map(this.schemaFromJson);
    } else {
      return mapObject(given, this.schemaFromJson);
    }
  }
}

export class Database extends EventEmitter {
  private static S_SHOULD_SAVE = 1 << 0;
  private static S_CLOSED = 1 << 1;
  private static S_STARTED = 1 << 2;

  private path: string;
  private state: number =
    ~Database.S_SHOULD_SAVE &
    ~Database.S_CLOSED &
    ~Database.S_STARTED;
  private file?: FileHandle;
  private content: { tables: { [key: string]: Table } } = { tables: {} };

  constructor(options: DatabaseOptions) {
    super();

    this.path = options.path;

    this.once("ready", () => {
      if (options.autosave !== 0) {
        for (const key in this.content.tables) {
          if (Object.prototype.hasOwnProperty.call(this.content.tables, key)) {
            const table = this.content.tables[key];
            table.on("stateChange", () => {
              this.shouldSave = true;
            });
          }
        }
        const saveInterval = setTimeout(() => this.save(), options.autosave ?? 5000).unref();
        process.once("beforeExit", () => this.close());
        this.once("close", () => {
          if (!this.closed) {
            this.shouldSave = true;
            this.save();
            clearInterval(saveInterval);
            this.shouldSave = false;
            this.removeAllListeners();
          }
        });
      }
    });
  }

  public async start() {
    try {
      try {
        await stat(this.path);
      } catch {
        try {
          await ensureFile(this.path);
        } catch {
          this.close();
          throw new Error(`Error while creating file '${this.path}': Cannot ensure file exists!`);
        }
        try {
          await chmod(this.path, 0o644);
        } catch {
          this.close();
          throw new Error(`Error while creating file '${this.path}': Cannot make file read/write!`);
        }
        try {
          await writeFile(this.path, "{\"tables\":{}}");
        } catch {
          this.close();
          throw new Error(`Error while creating file '${this.path}': Cannot write to file!`);
        }
      }
    } catch {
      this.close();
      throw new Error(`Cannot create file '${this.path}'!`);
    }
    if (!await checkFileAccess(this.path, fsconstants.R_OK)) {
      this.close();
      throw new Error(`File '${this.path}' is not readable!`);
    }
    if (!await checkFileAccess(this.path, fsconstants.W_OK)) {
      this.close();
      throw new Error(`File '${this.path}' is not writable!`);
    }

    this.started = true;
    this.file = await open(this.path, fsconstants.O_RDWR);

    const fileContents = JSON.parse((await this.file.readFile()).toString());
    for (const tableKey in fileContents.tables) {
      if (Object.prototype.hasOwnProperty.call(fileContents.tables, tableKey)) {
        const table = this.content.tables[tableKey];
        const tableContent: { [key: string]: { key: string } } | {}[] = table.fromJson(fileContents.tables[tableKey]);
        for (const key in tableContent) {
          if (Object.prototype.hasOwnProperty.call(tableContent, key)) {
            table.add(tableContent[key]);
          }
        }
      }
    }

    this.shouldSave = true;
    this.save();
    this.emit("ready");
  }

  private isSaving = false;
  private async save(): Promise<void> {
    if (this.shouldSave && !this.isSaving) {
      this.isSaving = true;
      this.shouldSave = false;
      const writeValue = Buffer.from(JSON.stringify(this.content, (_key, value) => value instanceof Table ? value.toJson() : value));
      this.file?.write(writeValue, 0, writeValue.length, 0);
      this.isSaving = false;
    }
    // throw new Error("Method not implemented.");
  }

  public close(): void {
    this.emit("close");
    this.file?.close();
    this.started = false;
    this.closed = true;
  }

  public addTable(key: string, table: Table): Table {
    if (!this.started) {
      this.content.tables[key] = table;
      return table;
    } else {
      throw new Error("Cannot modify tables after database started!");
    }
  }

  public deleteTable(key: string): Table | undefined {
    if (!this.started) {
      const table = this.content.tables[key];
      delete this.content.tables[key];
      return table;
    } else {
      throw new Error("Cannot modify tables after database started!");
    }
  }

  public getTable(key: string): Table | undefined {
    return this.content.tables[key];
  }

  public hasTable(key: string): boolean {
    return key in this.content.tables;
  }

  get shouldSave(): boolean {
    return checkBitmap(this.state, Database.S_SHOULD_SAVE);
  }

  set shouldSave(state: boolean) {
    if (state === true) {
      this.state |= Database.S_SHOULD_SAVE;
    } else {
      this.state &= ~Database.S_SHOULD_SAVE;
    }
  }

  get started(): boolean {
    return checkBitmap(this.state, Database.S_STARTED);
  }

  set started(state: boolean) {
    if (state === true) {
      this.state |= Database.S_STARTED;
    } else {
      this.state &= ~Database.S_STARTED;
    }
  }


  get closed(): boolean {
    return checkBitmap(this.state, Database.S_CLOSED);
  }

  set closed(state: boolean) {
    if (state === true) {
      this.state |= Database.S_CLOSED;
    } else {
      this.state &= ~Database.S_CLOSED;
    }
  }
}
