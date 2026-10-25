import { Controller, Get, HttpStatus, Inject } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { AppConfig } from '../../../config/app-config';
import { AppException } from '../../../shared/presentation/exception-filter';
import { SqsClientService } from '../../messaging/infrastructure/sqs/sqs-client.service';

@Controller()
export class HealthController {
  constructor(
    @Inject(EntityManager) private readonly em: EntityManager,
    @Inject(SqsClientService) private readonly sqs: SqsClientService,
    @Inject(AppConfig) private readonly config: AppConfig
  ) {}

  @Get('/health/live')
  live() {
    return { status: 'ok' };
  }

  @Get('/health/ready')
  async ready() {
    let postgres: 'ok' | 'fail' = 'ok';
    let sqs: 'ok' | 'fail' = 'ok';

    try {
      await this.em.execute('select 1');
    } catch {
      postgres = 'fail';
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);
      try {
        const attributes = await this.sqs.client.send(
          new GetQueueAttributesCommand({
            QueueUrl: this.config.sqsQueueUrl,
            AttributeNames: ['QueueArn']
          }),
          { abortSignal: controller.signal }
        );
        if (attributes.Attributes?.QueueArn === undefined) sqs = 'fail';
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      sqs = 'fail';
    }

    if (postgres === 'fail' || sqs === 'fail') {
      throw new AppException('SERVICE_UNAVAILABLE', 'dependencies not ready', HttpStatus.SERVICE_UNAVAILABLE, {
        postgres,
        sqs
      });
    }

    return { status: 'ready', postgres, sqs };
  }
}
