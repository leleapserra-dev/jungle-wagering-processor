import { InvalidInboxStateError } from '../../../shared/domain/errors';

export interface ReceiveInboxProps {
  id: string;
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface InboxMessageState extends ReceiveInboxProps {
  processedAt: Date | undefined;
}

export class InboxMessage {
  private constructor(
    public readonly id: string,
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt: Date | undefined
  ) {}

  static receive(props: ReceiveInboxProps): InboxMessage {
    if (props.messageId.length === 0 || props.consumerName.length === 0) {
      throw new InvalidInboxStateError('inbox identifiers must not be empty');
    }
    return new InboxMessage(
      props.id,
      props.messageId,
      props.consumerName,
      props.payloadHash,
      props.receivedAt,
      undefined
    );
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(
      state.id,
      state.messageId,
      state.consumerName,
      state.payloadHash,
      state.receivedAt,
      state.processedAt
    );
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  markProcessed(at: Date): void {
    if (this.isProcessed()) {
      throw new InvalidInboxStateError('inbox message was already processed', {
        consumerName: this.consumerName,
        messageId: this.messageId
      });
    }
    this._processedAt = at;
  }
}
