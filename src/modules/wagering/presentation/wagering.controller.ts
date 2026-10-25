import { Controller, Get, Post, Param, Headers, Body, UseGuards, HttpStatus, Inject } from '@nestjs/common';
import { ProcessWagerTransactionUseCase } from '../application/process-wager-transaction.use-case';
import { Money } from '../../../shared/domain/money';
import { AuthGuard } from '../../../shared/presentation/auth.guard';
import { AppException } from '../../../shared/presentation/exception-filter';
import { UuidV7Generator } from '../../../shared/domain/identity';
import { Sha256PayloadHasher } from '../../../shared/payload-hasher';
import { ZodValidationPipe } from '../../../shared/presentation/zod-validation.pipe';
import { uuidSchema } from '../../../shared/presentation/schemas';
import type { WagerTransactionRepository } from '../domain/wager-transaction.repository';
import { idempotencyKeySchema, submitWagerSchema, type SubmitWagerBody } from './submit-wager.dto';

function buildPayloadHash(body: SubmitWagerBody, hasher: Sha256PayloadHasher): string {
  return hasher.hash({
    providerId: body.providerId,
    externalTransactionId: body.externalTransactionId,
    playerId: body.playerId,
    walletId: body.walletId,
    roundId: body.roundId,
    gameId: body.gameId,
    kind: body.kind,
    money: body.money,
    referenceExternalTransactionId: body.referenceExternalTransactionId ?? null
  });
}

@Controller()
@UseGuards(AuthGuard)
export class WageringController {
  constructor(
    @Inject(ProcessWagerTransactionUseCase) private readonly processTx: ProcessWagerTransactionUseCase,
    @Inject('WagerTransactionRepository') private readonly wagerRepo: WagerTransactionRepository,
    @Inject(UuidV7Generator) private readonly ids: UuidV7Generator,
    @Inject(Sha256PayloadHasher) private readonly hasher: Sha256PayloadHasher
  ) {}

  @Post('/wagering/transactions')
  async submit(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-correlation-id') correlationIdHeader: string | undefined,
    @Headers('X-Correlation-Id') correlationIdHeader2: string | undefined,
    @Body(new ZodValidationPipe(submitWagerSchema)) body: SubmitWagerBody
  ) {
    const parsedKey = idempotencyKeySchema.safeParse(idempotencyKey);
    if (!parsedKey.success) {
      throw new AppException('BAD_REQUEST', 'Idempotency-Key header required', HttpStatus.BAD_REQUEST, {
        issues: parsedKey.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
      });
    }
    const key = parsedKey.data;
    const payloadHash = buildPayloadHash(body, this.hasher);
    const money = Money.from(body.money);
    const correlationId = correlationIdHeader ?? correlationIdHeader2 ?? this.ids.next();
    try {
      const result = await this.processTx.execute({
        correlationId,
        providerId: body.providerId,
        externalTransactionId: body.externalTransactionId,
        idempotencyKey: key,
        payloadHash,
        walletId: body.walletId,
        playerId: body.playerId,
        roundId: body.roundId,
        gameId: body.gameId,
        kind: body.kind,
        money,
        referenceExternalTransactionId: body.referenceExternalTransactionId,
        at: new Date()
      });
      if (result.transaction.status === 'REJECTED') {
        const res = {
          transactionId: result.transaction.id,
          status: result.transaction.status,
          failureCode: result.transaction.failureCode,
          balance: result.balance.toJSON(),
          idempotentReplay: result.idempotentReplay
        };
        throw new AppException(
          'BUSINESS_REJECTION',
          `transaction rejected: ${result.transaction.failureCode ?? 'UNKNOWN'}`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          res
        );
      }
      if (result.transaction.status === 'PENDING_REFERENCE') {
        return {
          transactionId: result.transaction.id,
          status: result.transaction.status,
          balance: result.balance.toJSON(),
          idempotentReplay: result.idempotentReplay
        };
      }
      return {
        transactionId: result.transaction.id,
        status: result.transaction.status,
        balance: result.balance.toJSON(),
        idempotentReplay: result.idempotentReplay
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'IdempotencyConflictError') {
        throw new AppException(
          'IDEMPOTENCY_KEY_CONFLICT',
          'idempotency key reused with different payload',
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }
  }

  @Get('/wagering/transactions/:transactionId')
  async getById(@Param('transactionId', new ZodValidationPipe(uuidSchema)) transactionId: string) {
    const tx = await this.wagerRepo.findById(transactionId);
    if (tx === null) throw new AppException('NOT_FOUND', 'transaction not found', HttpStatus.NOT_FOUND);
    return {
      id: tx.id,
      status: tx.status,
      kind: tx.kind,
      failureCode: tx.failureCode,
      balance: tx.observedBalance.toJSON()
    };
  }

  @Get('/providers/:providerId/wagering/transactions/:externalTransactionId')
  async getByExternal(@Param('providerId') providerId: string, @Param('externalTransactionId') externalTransactionId: string) {
    const tx = await this.wagerRepo.findByProviderExternal(providerId, externalTransactionId);
    if (tx === null) throw new AppException('NOT_FOUND', 'transaction not found', HttpStatus.NOT_FOUND);
    return {
      id: tx.id,
      status: tx.status,
      kind: tx.kind,
      failureCode: tx.failureCode,
      balance: tx.observedBalance.toJSON()
    };
  }
}
