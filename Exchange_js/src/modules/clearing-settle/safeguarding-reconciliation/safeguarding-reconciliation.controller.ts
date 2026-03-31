import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import {
  FiatStatementImportQueryDto,
  GenerateSafeguardingDailyDiffDto,
  ImportFiatStatementDto,
  SafeguardingBreakQueryDto,
  SafeguardingRunQueryDto,
  SafeguardingWarningQueryDto,
  UpdateReconciliationBreakStatusDto,
  UpdateReconciliationWarningStatusDto,
} from './dto/safeguarding-reconciliation.dto';
import { SafeguardingReconciliationService } from './safeguarding-reconciliation.service';

@ApiTags('Admin - Safeguarding Reconciliation')
@ApiBearerAuth()
@Controller('admin/reconciliation')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class SafeguardingReconciliationController {
  constructor(
    private readonly safeguardingReconciliationService: SafeguardingReconciliationService,
  ) {}

  @Post('safeguarding-breaks/generate-daily-diff')
  @ApiOperation({ summary: 'Run full safeguarding reconciliation for a business date' })
  @UsePipes(new ValidationPipe({ transform: true }))
  generateDailyDiff(@Req() req: any, @Body() dto: GenerateSafeguardingDailyDiffDto) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.safeguardingReconciliationService.generateDailyDiff(
      dto,
      operatorId,
    );
  }

  @Get('safeguarding-breaks')
  @ApiOperation({ summary: 'List safeguarding reconciliation breaks' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAllBreaks(@Query() query: SafeguardingBreakQueryDto) {
    return this.safeguardingReconciliationService.findAllForAdmin(query);
  }

  @Get('safeguarding-breaks/:id')
  @ApiOperation({ summary: 'Get safeguarding reconciliation break detail' })
  findOneBreak(@Param('id') id: string) {
    return this.safeguardingReconciliationService.findOneForAdmin(id);
  }

  @Patch('safeguarding-breaks/:id/status')
  @ApiOperation({ summary: 'Update safeguarding reconciliation break status' })
  @UsePipes(new ValidationPipe({ transform: true }))
  updateBreakStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateReconciliationBreakStatusDto,
  ) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.safeguardingReconciliationService.updateStatus(
      id,
      dto,
      operatorId,
    );
  }

  @Get('safeguarding-warnings')
  @ApiOperation({ summary: 'List safeguarding reconciliation warnings' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAllWarnings(@Query() query: SafeguardingWarningQueryDto) {
    return this.safeguardingReconciliationService.findWarningsForAdmin(query);
  }

  @Get('safeguarding-warnings/:id')
  @ApiOperation({ summary: 'Get safeguarding reconciliation warning detail' })
  findOneWarning(@Param('id') id: string) {
    return this.safeguardingReconciliationService.findWarningForAdmin(id);
  }

  @Patch('safeguarding-warnings/:id/status')
  @ApiOperation({ summary: 'Update safeguarding reconciliation warning status' })
  @UsePipes(new ValidationPipe({ transform: true }))
  updateWarningStatus(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateReconciliationWarningStatusDto,
  ) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.safeguardingReconciliationService.updateWarningStatus(
      id,
      dto,
      operatorId,
    );
  }

  @Get('safeguarding-runs')
  @ApiOperation({ summary: 'List safeguarding reconciliation runs' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAllRuns(@Query() query: SafeguardingRunQueryDto) {
    return this.safeguardingReconciliationService.findRunsForAdmin(query);
  }

  @Get('safeguarding-runs/:id')
  @ApiOperation({ summary: 'Get safeguarding reconciliation run detail' })
  findOneRun(@Param('id') id: string) {
    return this.safeguardingReconciliationService.findRunForAdmin(id);
  }

  @Post('safeguarding-runs/:id/export-evidence-package')
  @ApiOperation({ summary: 'Export safeguarding reconciliation evidence package' })
  exportEvidencePackage(@Req() req: any, @Param('id') id: string) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.safeguardingReconciliationService.exportEvidencePackage(
      id,
      operatorId,
    );
  }

  @Post('safeguarding-fiat-statements/imports')
  @ApiOperation({ summary: 'Import fiat bank statement CSV for safeguarding reconciliation' })
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new ValidationPipe({ transform: true }))
  importFiatStatement(
    @Req() req: any,
    @Body() dto: ImportFiatStatementDto,
    @UploadedFile() file: any,
  ) {
    const operatorId = req.user?.userId || 'SYSTEM';
    return this.safeguardingReconciliationService.importFiatStatement(
      dto,
      file,
      operatorId,
    );
  }

  @Get('safeguarding-fiat-statements/imports')
  @ApiOperation({ summary: 'List fiat statement imports' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAllFiatImports(@Query() query: FiatStatementImportQueryDto) {
    return this.safeguardingReconciliationService.findFiatStatementImports(
      query,
    );
  }

  @Get('safeguarding-fiat-statements/imports/:id')
  @ApiOperation({ summary: 'Get fiat statement import detail' })
  findOneFiatImport(@Param('id') id: string) {
    return this.safeguardingReconciliationService.findFiatStatementImport(id);
  }
}
