import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { expandLoopbackOrigins } from './common/utils/loopback-origin.util';
// import { AllExceptionsFilter } from './common/filters/all-exceptions.filter'; // Commented out until file is recreated

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);
  const port = configService.get<number>('API_PORT') || 3500;
  const adminUrl =
    configService.get<string>('ADMIN_URL') || 'http://localhost:3501';
  const clientUrl =
    configService.get<string>('CLIENT_URL') || 'http://localhost:3502';
  const allowedOrigins = new Set(
    expandLoopbackOrigins([adminUrl, clientUrl]),
  );

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
