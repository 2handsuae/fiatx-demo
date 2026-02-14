"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const nestjs_pino_1 = require("nestjs-pino");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const config_1 = require("@nestjs/config");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bufferLogs: true });
    const configService = app.get(config_1.ConfigService);
    const port = configService.get('API_PORT') || 3000;
    const adminUrl = configService.get('ADMIN_URL') || 'http://localhost:3001';
    const clientUrl = configService.get('CLIENT_URL') || 'http://localhost:3002';
    app.useLogger(app.get(nestjs_pino_1.Logger));
    app.useGlobalPipes(new common_1.ValidationPipe({ transform: true, whitelist: true }));
    app.enableCors({
        origin: [adminUrl, clientUrl],
        credentials: true,
    });
    const config = new swagger_1.DocumentBuilder()
        .setTitle('Exchange System API')
        .setDescription('The Exchange System API description')
        .setVersion('1.0')
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, config);
    swagger_1.SwaggerModule.setup('api', app, document);
    await app.listen(port);
    const logger = app.get(nestjs_pino_1.Logger);
    logger.log(`Application running on port ${port}`);
}
bootstrap();
//# sourceMappingURL=main.js.map