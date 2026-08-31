import * as path from 'path';
import * as dotenv from 'dotenv';

// Loaded before `import { AppModule }` below: ConfigModule.forRoot() (called inside
// AppModule's own @Module() decorator) only loads .env as part of evaluating AppModule's
// imports array — which runs AFTER all of AppModule's own imports (every submodule,
// transitively) have already been required and their own @Module() decorators evaluated.
// A submodule that reads process.env.X directly inside its own @Module() decorator (e.g.
// deposit-sumsub.module.ts's SUMSUB_MOCK_MODE-gated controller registration, Task 6) would
// otherwise only ever see pre-.env values (i.e. undefined) at that point. Mirrors the same
// workaround already used in test/deposit-sumsub-scenarios.e2e-spec.ts.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { buildAllowedWebOrigins } from './common/utils/loopback-origin.util';
// import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'; // Commented out until file is recreated

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const configService = app.get(ConfigService);
  const port = configService.get<number>('API_PORT') || 3000;
  const adminUrl =
    configService.get<string>('ADMIN_URL') || 'http://localhost:3001';
  const clientUrl =
    configService.get<string>('CLIENT_URL') || 'http://localhost:3002';
  const allowedOrigins = new Set(buildAllowedWebOrigins(adminUrl, clientUrl));

  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  // Enable CORS for Admin and Client
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  });

  // const httpAdapter = app.get(HttpAdapterHost);
  // app.useGlobalFilters(new AllExceptionsFilter(httpAdapter));

  const config = new DocumentBuilder()
    .setTitle('Exchange System API')
    .setDescription('The Exchange System API description')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(port);
  const logger = app.get(Logger);
  logger.log(`Application running on port ${port}`);
}
bootstrap();
