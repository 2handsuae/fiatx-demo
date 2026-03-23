import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { BusinessConfigService } from './business-config.service';
import {
  BusinessConfigReleaseQueryDto,
  BusinessConfigRevisionQueryDto,
} from './dto/business-config.dto';

const CHANGE_TICKET_READ_PERMISSION = buildPermissionCode(
  'GET',
  '/admin/control-gates/change-tickets',
);

@ApiTags('Admin - Business Config Releases')
@ApiBearerAuth()
@Controller('admin/business-config')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class BusinessConfigController {
  constructor(private readonly businessConfigService: BusinessConfigService) {}

  @Get('releases')
  @RequirePermissions(CHANGE_TICKET_READ_PERMISSION)
  @ApiOperation({ summary: 'List business config releases by subject' })
  listReleases(
    @Query(new ValidationPipe({ transform: true }))
    query: BusinessConfigReleaseQueryDto,
  ) {
    return this.businessConfigService.listReleases(query);
  }

  @Get('releases/:releaseNo')
  @RequirePermissions(CHANGE_TICKET_READ_PERMISSION)
  @ApiOperation({ summary: 'Get business config release detail' })
  getRelease(@Param('releaseNo') releaseNo: string) {
    return this.businessConfigService.getReleaseByNo(releaseNo);
  }

  @Get('releases/:releaseNo/diff')
  @RequirePermissions(CHANGE_TICKET_READ_PERMISSION)
  @ApiOperation({ summary: 'Get business config release diff' })
  getReleaseDiff(@Param('releaseNo') releaseNo: string) {
    return this.businessConfigService.getReleaseDiff(releaseNo);
  }

  @Get('revisions')
  @RequirePermissions(CHANGE_TICKET_READ_PERMISSION)
  @ApiOperation({ summary: 'List revisions for a business config item' })
  listRevisions(
    @Query(new ValidationPipe({ transform: true }))
    query: BusinessConfigRevisionQueryDto,
  ) {
    return this.businessConfigService.listRevisions(query);
  }

  @Get('revisions/:id')
  @RequirePermissions(CHANGE_TICKET_READ_PERMISSION)
  @ApiOperation({ summary: 'Get business config revision detail' })
  getRevision(@Param('id') id: string) {
    return this.businessConfigService.getRevisionById(id);
  }
}
