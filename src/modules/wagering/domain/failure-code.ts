export enum FailureCode {
  InsufficientFunds = 'INSUFFICIENT_FUNDS',
  ReversalWouldOverdraw = 'REVERSAL_WOULD_OVERDRAW',
  ReferenceRequired = 'REFERENCE_REQUIRED',
  ReferenceNotFound = 'REFERENCE_NOT_FOUND',
  ReferenceNotProcessed = 'REFERENCE_NOT_PROCESSED',
  ReferenceMismatch = 'REFERENCE_MISMATCH',
  InvalidReferenceKind = 'INVALID_REFERENCE_KIND',
  AlreadyReversed = 'ALREADY_REVERSED',
  AmountMismatch = 'AMOUNT_MISMATCH',
  CurrencyMismatch = 'CURRENCY_MISMATCH',
  PlayerMismatch = 'PLAYER_MISMATCH',
  WalletMismatch = 'WALLET_MISMATCH',
  RoundMismatch = 'ROUND_MISMATCH',
  ProviderMismatch = 'PROVIDER_MISMATCH',
  InvalidKind = 'INVALID_KIND',
  InvalidTransition = 'INVALID_TRANSITION'
}
