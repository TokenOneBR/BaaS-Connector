{{/*
Helpers do chart.

Um template EXPLICITO por componente, e nao um `range` sobre um mapa: mais
verboso, e legivel por qualquer pessoa que saiba Kubernetes sem antes precisar
aprender este chart. Para um projeto open source que as pessoas vao
auto-hospedar e adaptar, essa e a troca certa.
*/}}

{{- define "baas.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "baas.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "baas.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "baas.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "baas.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: baas-connector
{{- end -}}

{{- define "baas.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "baas.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "baas.secretName" -}}
{{- default (printf "%s-secrets" (include "baas.fullname" .)) .Values.secrets.existingSecret -}}
{{- end -}}

{{- define "baas.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion -}}
{{- printf "%s/%s-%s:%s" .Values.image.registry .Values.image.repository .component $tag -}}
{{- end -}}

{{/*
Ambiente comum a API e ao worker.

Os quatro segredos vem do Secret; TODO o resto do produto — credencial de
provedor, segredo de webhook de saida, chave de API — e linha cifrada no
Postgres, com a data key envolvida pelo KMS. E por isso que adicionar um
provedor nao exige redeploy.
*/}}
{{- define "baas.commonEnv" -}}
- name: NODE_ENV
  value: production
- name: LOG_LEVEL
  value: {{ .Values.config.logLevel | quote }}
- name: LOG_PRETTY
  value: "false"
- name: PUBLIC_BASE_URL
  value: {{ .Values.config.publicBaseUrl | quote }}
- name: CONSOLE_ORIGIN
  value: {{ .Values.config.consoleOrigin | quote }}
- name: ENVIRONMENTS
  value: {{ join "," .Values.config.environments | quote }}
- name: BALANCE_CACHE_TTL
  value: {{ .Values.config.balanceCacheTtl | quote }}
- name: POST_MUTATION_BYPASS
  value: {{ .Values.config.postMutationBypass | quote }}
- name: CACHE_VERSION
  value: {{ .Values.config.cacheVersion | quote }}
- name: SIGNATURE_TOLERANCE
  value: {{ .Values.config.signatureTolerance | quote }}
- name: EXPOSE_PROVIDER_MESSAGES
  value: {{ .Values.config.exposeProviderMessages | quote }}
- name: KMS_DRIVER
  value: {{ .Values.kms.driver | quote }}
{{- if .Values.kms.keyId }}
- name: KMS_KEY_ID
  value: {{ .Values.kms.keyId | quote }}
{{- end }}
{{- if .Values.config.otlpEndpoint }}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ .Values.config.otlpEndpoint | quote }}
- name: OTEL_TRACES_SAMPLER_ARG
  value: {{ .Values.config.tracesSamplerArg | quote }}
{{- end }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef: { name: {{ include "baas.secretName" . }}, key: DATABASE_URL }
- name: REDIS_URL
  valueFrom:
    secretKeyRef: { name: {{ include "baas.secretName" . }}, key: REDIS_URL }
- name: JWT_PRIVATE_KEY
  valueFrom:
    secretKeyRef: { name: {{ include "baas.secretName" . }}, key: JWT_PRIVATE_KEY }
- name: JWT_PUBLIC_KEY
  valueFrom:
    secretKeyRef: { name: {{ include "baas.secretName" . }}, key: JWT_PUBLIC_KEY }
{{- if eq .Values.kms.driver "local" }}
- name: KMS_MASTER_SECRET
  valueFrom:
    secretKeyRef: { name: {{ include "baas.secretName" . }}, key: KMS_MASTER_SECRET }
{{- end }}
- name: BLIND_INDEX_PEPPER
  valueFrom:
    secretKeyRef: { name: {{ include "baas.secretName" . }}, key: BLIND_INDEX_PEPPER }
{{- end -}}

{{/*
Agendamento e postura de seguranca, iguais em todo pod.
*/}}
{{- define "baas.podCommon" -}}
serviceAccountName: {{ include "baas.serviceAccountName" .root }}
securityContext:
{{ toYaml .root.Values.podSecurityContext | indent 2 }}
{{- with .root.Values.image.pullSecrets }}
imagePullSecrets:
{{ toYaml . | indent 2 }}
{{- end }}
{{- with .root.Values.nodeSelector }}
nodeSelector:
{{ toYaml . | indent 2 }}
{{- end }}
{{- with .root.Values.tolerations }}
tolerations:
{{ toYaml . | indent 2 }}
{{- end }}
{{- if .root.Values.topologySpreadConstraints.enabled }}
topologySpreadConstraints:
  - maxSkew: {{ .root.Values.topologySpreadConstraints.maxSkew }}
    topologyKey: {{ .root.Values.topologySpreadConstraints.topologyKey }}
    whenUnsatisfiable: {{ .root.Values.topologySpreadConstraints.whenUnsatisfiable }}
    labelSelector:
      matchLabels:
        app.kubernetes.io/name: {{ include "baas.name" .root }}
        app.kubernetes.io/instance: {{ .root.Release.Name }}
        app.kubernetes.io/component: {{ .component }}
{{- end }}
{{- end -}}

{{/*
`readOnlyRootFilesystem` obriga um `emptyDir` gravavel: o engine do Prisma
extrai um binario temporario, e o Next escreve cache de imagem.
*/}}
{{- define "baas.tmpVolume" -}}
- name: tmp
  emptyDir: {}
{{- end -}}
