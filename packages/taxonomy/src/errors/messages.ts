import { BaasErrorCode } from './codes.js';

/**
 * Catalogo de mensagens em pt-BR.
 *
 * Existe porque as equipes de suporte sao brasileiras e uma camada de traducao
 * entre o codigo de erro e o atendimento custa tempo em incidente. Nao e
 * traducao automatica: cada linha e escrita.
 */
export const ERROR_MESSAGES_PT_BR: Readonly<Partial<Record<BaasErrorCode, string>>> = Object.freeze(
  {
    [BaasErrorCode.VALIDATION_ERROR]: 'Os dados enviados nao passaram na validacao.',
    [BaasErrorCode.MISSING_REQUIRED_FIELD]: 'Um campo obrigatorio nao foi informado.',
    [BaasErrorCode.INVALID_TAX_ID]: 'O CPF ou CNPJ informado nao e valido.',
    [BaasErrorCode.INVALID_PIX_KEY]: 'A chave Pix informada nao e valida.',
    [BaasErrorCode.INVALID_AMOUNT]: 'O valor informado nao e valido.',
    [BaasErrorCode.INVALID_EMV_PAYLOAD]: 'O codigo Pix copia e cola nao e valido.',
    [BaasErrorCode.INVALID_END_TO_END_ID]: 'O EndToEndId nao esta no formato do Banco Central.',
    [BaasErrorCode.INVALID_CURSOR]: 'O cursor de paginacao e invalido ou os filtros mudaram.',
    [BaasErrorCode.CURRENCY_MISMATCH]: 'As moedas envolvidas na operacao sao incompativeis.',
    [BaasErrorCode.CONCURRENT_MODIFICATION]:
      'O recurso foi alterado por outra requisicao. Tente novamente.',
    [BaasErrorCode.CHARGE_NOT_FOUND]: 'Cobranca nao encontrada.',
    [BaasErrorCode.CONNECTION_NOT_FOUND]: 'Conexao de provedor nao encontrada.',
    [BaasErrorCode.PROVIDER_NOT_FOUND]: 'Provedor nao encontrado.',
    [BaasErrorCode.PROVIDER_INTERNAL_ERROR]:
      'O provedor respondeu com erro interno. A operacao pode nao ter sido concluida.',
    [BaasErrorCode.PROVIDER_CONTRACT_VIOLATION]:
      'A resposta do provedor nao esta no formato esperado.',
    [BaasErrorCode.PROVIDER_CREDENTIALS_INVALID]:
      'As credenciais configuradas para este provedor sao invalidas.',
    [BaasErrorCode.MISSING_IDEMPOTENCY_KEY]:
      'Esta operacao movimenta dinheiro e exige o cabecalho Idempotency-Key.',
    [BaasErrorCode.AUTHENTICATION_FAILED]: 'Falha na autenticacao.',
    [BaasErrorCode.INVALID_API_KEY]: 'A chave de API e invalida.',
    [BaasErrorCode.API_KEY_REVOKED]: 'A chave de API foi revogada.',
    [BaasErrorCode.SIGNATURE_INVALID]: 'A assinatura da requisicao nao confere.',
    [BaasErrorCode.SIGNATURE_EXPIRED]: 'A assinatura da requisicao expirou.',
    [BaasErrorCode.NONCE_REPLAYED]: 'Este nonce ja foi utilizado.',
    [BaasErrorCode.SESSION_EXPIRED]: 'Sua sessao expirou. Entre novamente.',
    [BaasErrorCode.MFA_REQUIRED]: 'Informe o codigo de verificacao em duas etapas.',
    [BaasErrorCode.AUTHORIZATION_DENIED]: 'Acesso negado para este recurso.',
    [BaasErrorCode.INSUFFICIENT_SCOPE]: 'A chave de API nao possui o escopo necessario.',
    [BaasErrorCode.ENVIRONMENT_MISMATCH]:
      'A chave de API pertence a outro ambiente que o recurso solicitado.',
    [BaasErrorCode.RESOURCE_NOT_FOUND]: 'Recurso nao encontrado.',
    [BaasErrorCode.ACCOUNT_NOT_FOUND]: 'Conta nao encontrada.',
    [BaasErrorCode.TRANSACTION_NOT_FOUND]: 'Transacao nao encontrada.',
    [BaasErrorCode.PIX_KEY_NOT_FOUND]: 'Chave Pix nao encontrada no DICT.',
    [BaasErrorCode.RESOURCE_ALREADY_EXISTS]: 'Ja existe um recurso com este identificador.',
    [BaasErrorCode.PIX_KEY_ALREADY_EXISTS]: 'Esta chave Pix ja esta cadastrada.',
    [BaasErrorCode.IDEMPOTENCY_KEY_REUSED]:
      'Esta Idempotency-Key ja foi usada com um corpo de requisicao diferente.',
    [BaasErrorCode.IDEMPOTENT_REQUEST_IN_PROGRESS]:
      'Uma requisicao com esta Idempotency-Key ainda esta em processamento.',
    [BaasErrorCode.INVALID_STATE_TRANSITION]: 'A transicao de estado solicitada nao e permitida.',
    [BaasErrorCode.INSUFFICIENT_FUNDS]: 'Saldo insuficiente para a operacao.',
    [BaasErrorCode.ACCOUNT_NOT_ACTIVE]: 'A conta nao esta ativa.',
    [BaasErrorCode.ACCOUNT_BLOCKED]: 'A conta esta bloqueada.',
    [BaasErrorCode.LIMIT_EXCEEDED]: 'Limite de transacao excedido.',
    [BaasErrorCode.OUTSIDE_OPERATING_HOURS]: 'Operacao fora do horario permitido.',
    [BaasErrorCode.CHARGE_EXPIRED]: 'A cobranca expirou.',
    [BaasErrorCode.CHARGE_ALREADY_PAID]: 'A cobranca ja foi paga.',
    [BaasErrorCode.REFUND_WINDOW_EXPIRED]: 'A janela de 90 dias para devolucao Pix ja se encerrou.',
    [BaasErrorCode.REFUND_AMOUNT_EXCEEDS_ORIGINAL]:
      'O valor da devolucao excede o valor da transacao original.',
    [BaasErrorCode.TRANSACTION_NOT_REVERSIBLE]: 'Esta transacao nao pode ser revertida.',
    [BaasErrorCode.SELF_TRANSFER_NOT_ALLOWED]: 'Nao e possivel transferir para a propria conta.',
    [BaasErrorCode.ONBOARDING_REQUIRED]: 'E necessario concluir o onboarding da conta.',
    [BaasErrorCode.ONBOARDING_PENDING]: 'O onboarding ainda esta em analise.',
    [BaasErrorCode.COMPLIANCE_REJECTED]: 'A analise de compliance recusou a solicitacao.',
    [BaasErrorCode.SANCTIONS_BLOCK]: 'Operacao bloqueada por restricao de listas de sancoes.',
    [BaasErrorCode.DOCUMENT_REQUIRED]: 'E necessario enviar documentos adicionais.',
    [BaasErrorCode.PROVIDER_UNAVAILABLE]: 'O provedor esta indisponivel no momento.',
    [BaasErrorCode.PROVIDER_TIMEOUT]: 'O provedor nao respondeu no tempo esperado.',
    [BaasErrorCode.PROVIDER_RATE_LIMITED]: 'Limite de requisicoes do provedor atingido.',
    [BaasErrorCode.PROVIDER_REJECTED]: 'O provedor recusou a operacao.',
    [BaasErrorCode.PROVIDER_CIRCUIT_OPEN]:
      'As chamadas a este provedor estao temporariamente suspensas por excesso de falhas.',
    [BaasErrorCode.PROVIDER_OUTCOME_UNKNOWN]:
      'A operacao foi enviada mas o desfecho ainda e desconhecido; sera resolvida por conciliacao.',
    [BaasErrorCode.CAPABILITY_NOT_SUPPORTED]:
      'O provedor configurado nao oferece esta funcionalidade.',
    [BaasErrorCode.CAPABILITY_CONSTRAINT_VIOLATED]:
      'A operacao viola uma restricao declarada pelo provedor.',
    [BaasErrorCode.RATE_LIMITED]: 'Limite de requisicoes atingido. Tente novamente em instantes.',
    [BaasErrorCode.INTERNAL_ERROR]: 'Erro interno. A equipe foi notificada.',
    [BaasErrorCode.NOT_IMPLEMENTED]: 'Funcionalidade ainda nao implementada.',
  },
);
