import type { BusinessCalendar, EffectiveDate } from './types.js';

/**
 * Domingo de Pascoa gregoriano, por Meeus/Jones/Butcher.
 *
 * Calcular em vez de tabelar: uma tabela de feriados precisa ser mantida e
 * fica errada em SILENCIO — o unico sintoma seria um `DATE_MISMATCH` falso em
 * fevereiro, tres anos depois de alguem esquecer de atualizar o arquivo.
 */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** Feriados nacionais de data fixa. `MM-DD`. */
const FIXOS: readonly string[] = Object.freeze([
  '01-01', // Confraternizacao Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independencia
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamacao da Republica
  '12-25', // Natal
]);

/** Consciencia Negra virou feriado NACIONAL pela Lei 14.759/2023. */
const CONSCIENCIA_NEGRA_DESDE = 2024;

export interface CalendarOptions {
  /**
   * 24 e 31 de dezembro: banco fechado ao publico, SPI operando.
   *
   * Padrao `false` porque o que importa aqui e quando o EXTRATO posta, e o
   * provedor pode postar nesses dias.
   */
  treatChristmasEveAsHoliday?: boolean;
}

/**
 * Calendario bancario nacional, calculado.
 *
 * O que NAO cobre, declarado de proposito:
 *
 * - **Feriados estaduais e municipais.** O SPI e nacional e o extrato do
 *   provedor segue o calendario bancario nacional. Tratar um feriado
 *   municipal como dia util apenas ENCOLHE a janela do passe 3 em um dia — o
 *   erro e conservador: gera no maximo um `MISSING_ON_*` a mais, em vez de um
 *   casamento errado a menos.
 * - **Quarta-feira de Cinzas.** Expediente a partir do meio-dia; conta como
 *   dia util.
 *
 * Um provedor com calendario proprio injeta a sua implementacao da porta.
 */
export class BrazilianBankCalendar implements BusinessCalendar {
  private readonly porAno = new Map<number, Set<string>>();

  constructor(private readonly options: CalendarOptions = {}) {}

  isBusinessDay(date: EffectiveDate): boolean {
    const [year, month, day] = parse(date);
    const dia = new Date(Date.UTC(year, month - 1, day));
    const semana = dia.getUTCDay();

    if (semana === 0 || semana === 6) return false;
    return !this.holidays(year).has(`${pad(month)}-${pad(day)}`);
  }

  addBusinessDays(date: EffectiveDate, days: number): EffectiveDate {
    if (days === 0) return date;

    const passo = days > 0 ? 1 : -1;
    let restantes = Math.abs(days);
    let atual = date;

    while (restantes > 0) {
      atual = shift(atual, passo);
      if (this.isBusinessDay(atual)) restantes -= 1;
    }
    return atual;
  }

  /**
   * Dias uteis entre duas datas, sempre positivo.
   *
   * O extremo inicial nao conta e o final conta — a mesma convencao de
   * "D+1" que o mercado usa.
   */
  businessDaysBetween(from: EffectiveDate, to: EffectiveDate): number {
    if (from === to) return 0;

    const [inicio, fim] = from < to ? [from, to] : [to, from];
    let atual = inicio;
    let total = 0;

    while (atual < fim) {
      atual = shift(atual, 1);
      if (this.isBusinessDay(atual)) total += 1;
    }
    return total;
  }

  /** Memoiza por ano: `isBusinessDay` roda por candidato, em laco. */
  private holidays(year: number): Set<string> {
    const cached = this.porAno.get(year);
    if (cached) return cached;

    const conjunto = new Set<string>(FIXOS);
    if (year >= CONSCIENCIA_NEGRA_DESDE) conjunto.add('11-20');
    if (this.options.treatChristmasEveAsHoliday) {
      conjunto.add('12-24');
      conjunto.add('12-31');
    }

    const pascoa = easterSunday(year);
    const base = `${year}-${pad(pascoa.month)}-${pad(pascoa.day)}`;
    // Carnaval e a semana em que a conciliacao mais erraria sem calendario:
    // dois dias uteis somem no meio de uma janela de dois dias uteis.
    for (const offset of [-48, -47, -2, 60]) {
      const data = shift(base, offset);
      conjunto.add(data.slice(5));
    }

    this.porAno.set(year, conjunto);
    return conjunto;
  }
}

/**
 * Calendario que so conhece fins de semana.
 *
 * Existe para teste e para provedor cujo calendario nao conhecemos. Em
 * producao o nacional e o padrao.
 */
export class WeekendOnlyCalendar implements BusinessCalendar {
  isBusinessDay(date: EffectiveDate): boolean {
    const [year, month, day] = parse(date);
    const semana = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return semana !== 0 && semana !== 6;
  }

  addBusinessDays(date: EffectiveDate, days: number): EffectiveDate {
    if (days === 0) return date;
    const passo = days > 0 ? 1 : -1;
    let restantes = Math.abs(days);
    let atual = date;
    while (restantes > 0) {
      atual = shift(atual, passo);
      if (this.isBusinessDay(atual)) restantes -= 1;
    }
    return atual;
  }

  businessDaysBetween(from: EffectiveDate, to: EffectiveDate): number {
    if (from === to) return 0;
    const [inicio, fim] = from < to ? [from, to] : [to, from];
    let atual = inicio;
    let total = 0;
    while (atual < fim) {
      atual = shift(atual, 1);
      if (this.isBusinessDay(atual)) total += 1;
    }
    return total;
  }
}

function parse(date: EffectiveDate): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number);
  return [year!, month!, day!];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Move N dias corridos.
 *
 * `Date.UTC` e nao o fuso local: a data efetiva ja E o dia bancario
 * brasileiro, e reinterpreta-la num fuso mudaria o dia em metade das
 * maquinas de CI.
 */
function shift(date: EffectiveDate, days: number): EffectiveDate {
  const [year, month, day] = parse(date);
  const movido = new Date(Date.UTC(year, month - 1, day + days));
  return `${movido.getUTCFullYear()}-${pad(movido.getUTCMonth() + 1)}-${pad(movido.getUTCDate())}`;
}
