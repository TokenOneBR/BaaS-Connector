# ADR 0018: Lock por agregado no Redis, e não grupos do BullMQ

- **Status:** Aceito
- **Data:** 2026-08-30

## Contexto

O plano do projeto dizia, em mais de um lugar, que a ordenação FIFO por
agregado — todos os eventos de uma mesma conta ou transação processados em
ordem, com paralelismo entre agregados diferentes — seria feita com **grupos do
BullMQ**, substituindo o `KeyedMutex` em processo que o marco anterior
entregou.

A premissa é **falsa**. Grupos são um recurso do **BullMQ Pro**, que é
comercial. O BullMQ open source, que é o que está no lockfile e o que qualquer
pessoa que auto-hospedar este projeto vai usar, não os tem.

Registro isto como ADR em vez de corrigir o plano em silêncio porque é
exatamente o tipo de premissa que alguém vai reabrir — "por que não usamos
grupos?" — e a resposta precisa estar escrita.

## Decisão

**A ordenação correta nunca dependeu de grupos.** Ela vem de duas coisas que já
existem e que são independentes do broker:

1. o `SELECT ... FOR UPDATE` da linha do agregado, mantido do SELECT ao COMMIT;
2. o `decideMonotonic` avaliado **dentro** desse lock, que recusa um evento
   mais velho ou de posto inferior ao estado atual.

Juntos, absorvem ordem e duplicata mesmo com dois workers processando eventos
do mesmo agregado ao mesmo tempo. O desfecho é correto sem nenhuma
serialização de fila.

O que os grupos dariam é **eficiência**: evitar trabalho jogado fora e
violações de constraint como ruído de log. Isso conseguimos com um **lock por
agregado no Redis** (`SET NX PX`), que é uma dúzia de linhas e não depende de
licença.

## Consequências

**Perder o Redis não pode conceder o lock.** Um `SET NX` que falha por erro de
conexão é indistinguível, para quem chama, de um `SET NX` que falha por o lock
estar tomado — e tratar erro como "livre" transformaria a degradação do Redis
em processamento concorrente do mesmo agregado, justamente quando o sistema já
está sob estresse. O lock **recusa** em erro, e o job volta para a fila. Há
teste, e a mutação que concede em erro o mata.

**O lock é otimização, não correção.** Se ele estiver desligado, ou se o Redis
sumir e todos os jobs forem reenfileirados, o desfecho continua correto — mais
lento e mais barulhento, nunca errado. Essa propriedade é o que permite tratar
o Redis como cache de coordenação e não como parte do modelo de consistência.

**Um caso legítimo permanece em processo.** O `KeyedMutex` não sai: dentro de
um mesmo pod ele é mais barato que uma ida ao Redis, e as duas camadas se
compõem — o lock distribuído serializa entre pods, o mutex serializa dentro de
um.

**Agendamento também não usa `@nestjs/schedule`.** Um `@Cron` dispara em TODO
pod: três réplicas produziriam três `recon.daily` às 03:00, e a chave única de
`ReconciliationRun` transformaria duas em violação de constraint — desfecho
correto, sinal horrível, e as chamadas ao provedor já gastas. Os jobs
repetíveis do BullMQ (esses, sim, na versão open source) produzem um job por
intervalo no cluster inteiro e sobrevivem a restart: um cluster fora das 02:55
às 03:05 dispara **atrasado** em vez de nunca. Para conciliação diária,
atrasado e nunca são incidentes diferentes.

A exceção são as varreduras sub-minuto (outbox, entregas, operações presas,
métricas), que usam `setInterval().unref()`: um cron de 1 s no Redis seriam
86 400 entradas de scheduler por dia para um trabalho que o `FOR UPDATE SKIP
LOCKED` já torna seguro rodar em todo pod.
