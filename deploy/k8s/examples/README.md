# Exemplo de instalacao

`values-example.yaml` e o conjunto de valores que o CI usa para renderizar e
validar o chart. Renderize localmente com:

```bash
helm template baas ../../helm/baas-connector -f values-example.yaml
```

## Por que este arquivo existe

O chart e template Go: so vira YAML depois de renderizado, entao um erro de
indentacao dentro de um bloco `{{- if }}` nao aparece ate alguem instalar. O
workflow `helm.yml` renderiza com estes valores e passa o resultado por
`helm lint`, `kubeconform` (Kubernetes 1.28 a 1.31) e `helm-docs --check`.

Os valores sao deliberadamente NAO representativos de producao em dois pontos,
e os dois estao marcados no arquivo: `secrets.create` e `kms.driver: local`.
Um exemplo que exigisse um KMS de nuvem para renderizar nao seria exemplo de
nada.

## O que este diretorio ainda nao tem

O plano previa guardar aqui o `helm template` **ja renderizado**, como base
kustomize e como diff legivel de Kubernetes a cada mudanca no chart. Nao esta
commitado: o ambiente onde o chart foi escrito nao tem o binario do helm
(`get.helm.sh` e bloqueado pelo proxy de egresso), e commitar um render feito
a mao seria pior que nao ter nenhum — ele divergiria do chart na primeira
mudanca, e ninguem saberia qual dos dois esta certo.

Para adicionar: rode o `helm template` acima com `--output-dir rendered/`,
commite o resultado, e acrescente ao `helm.yml` um passo que regenera e roda
`git diff --exit-code` sobre o diretorio. E o mesmo padrao que o
`openapi.json` ja usa.

Enquanto isso, `helm.yml` renderiza a cada PR, valida com `kubeconform` e
publica o resultado como artefato — a validacao acontece, so nao ha copia
versionada para revisar no diff.
