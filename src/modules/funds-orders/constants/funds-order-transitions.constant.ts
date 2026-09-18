import { FundsOrderAction, FundsOrderStatus, FundsOrderDirection, FundsOrderAssetType } from '../dto/funds-order.dto';

type Transitions = Partial<Record<FundsOrderStatus, Partial<Record<FundsOrderAction, FundsOrderStatus>>>>;

// crypto OUT / INTERNAL — 全 5 hop
export const CRYPTO_OUT_TRANSITIONS: Transitions = {
  [FundsOrderStatus.CREATED]: {
    [FundsOrderAction.SUBMIT]: FundsOrderStatus.SUBMITTED,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
  },
  [FundsOrderStatus.SUBMITTED]: {
    [FundsOrderAction.OBSERVE_CONFIRMING]: FundsOrderStatus.CONFIRMING,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
    [FundsOrderAction.TIMEOUT]: FundsOrderStatus.TIMEOUT,
  },
  [FundsOrderStatus.CONFIRMING]: {
    [FundsOrderAction.CONFIRM]: FundsOrderStatus.CONFIRMED,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
    [FundsOrderAction.TIMEOUT]: FundsOrderStatus.TIMEOUT,
  },
  [FundsOrderStatus.CONFIRMED]: {
    [FundsOrderAction.CLEAR]: FundsOrderStatus.CLEARED,
  },
};

// fiat OUT — 无 CONFIRMING
export const FIAT_OUT_TRANSITIONS: Transitions = {
  [FundsOrderStatus.CREATED]: {
    [FundsOrderAction.SUBMIT]: FundsOrderStatus.SUBMITTED,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
  },
  [FundsOrderStatus.SUBMITTED]: {
    [FundsOrderAction.CONFIRM]: FundsOrderStatus.CONFIRMED,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
    [FundsOrderAction.TIMEOUT]: FundsOrderStatus.TIMEOUT,
  },
  [FundsOrderStatus.CONFIRMED]: {
    [FundsOrderAction.CLEAR]: FundsOrderStatus.CLEARED,
  },
};

// crypto IN — 入口 SUBMITTED
export const CRYPTO_IN_TRANSITIONS: Transitions = {
  [FundsOrderStatus.SUBMITTED]: {
    [FundsOrderAction.OBSERVE_CONFIRMING]: FundsOrderStatus.CONFIRMING,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
  },
  [FundsOrderStatus.CONFIRMING]: {
    [FundsOrderAction.CONFIRM]: FundsOrderStatus.CONFIRMED,
    [FundsOrderAction.FAIL]: FundsOrderStatus.FAILED,
  },
  [FundsOrderStatus.CONFIRMED]: {
    [FundsOrderAction.CLEAR]: FundsOrderStatus.CLEARED,
  },
};

// fiat IN — 入口 CONFIRMED
export const FIAT_IN_TRANSITIONS: Transitions = {
  [FundsOrderStatus.CONFIRMED]: {
    [FundsOrderAction.CLEAR]: FundsOrderStatus.CLEARED,
  },
};

export function getTransitionMap(direction: FundsOrderDirection, assetType: FundsOrderAssetType): Transitions {
  const isCrypto = assetType === 'CRYPTO';
  if (direction === 'IN') return isCrypto ? CRYPTO_IN_TRANSITIONS : FIAT_IN_TRANSITIONS;
  return isCrypto ? CRYPTO_OUT_TRANSITIONS : FIAT_OUT_TRANSITIONS;
}

export const TERMINAL_STATUSES = new Set<FundsOrderStatus>([
  FundsOrderStatus.CLEARED,
  FundsOrderStatus.FAILED,
  FundsOrderStatus.TIMEOUT,
]);
