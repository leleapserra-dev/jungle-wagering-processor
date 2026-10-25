import { v7 as uuidv7 } from 'uuid';

export interface IdGenerator {
  next(): string;
}

export class UuidV7Generator implements IdGenerator {
  next(): string {
    return uuidv7();
  }
}

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
