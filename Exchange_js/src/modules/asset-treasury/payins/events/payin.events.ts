import { PayinSimulationMode, PayinStatus, PayinType } from '../dto/payin.dto';

export class PayinStatusChangedEvent {
  constructor(
    public readonly payinId: string,
    public readonly oldStatus: PayinStatus,
    public readonly newStatus: PayinStatus,
    public readonly type: PayinType,
    public readonly depositId?: string | null,
    public readonly assetId?: string,
    public readonly amount?: string,
    public readonly simulationMode?: PayinSimulationMode | null,
  ) {}
}

export class PayinCreatedEvent {
  constructor(
    public readonly payinId: string,
    public readonly status: PayinStatus,
    public readonly type: PayinType,
    public readonly depositId?: string | null,
    public readonly assetId?: string,
    public readonly amount?: string,
  ) {}
}
