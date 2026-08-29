import { describe, expect, it } from 'vitest';

import { BrazilianBankCalendar, WeekendOnlyCalendar, easterSunday } from './calendar.js';

describe('Pascoa', () => {
  it('bate com as datas conhecidas', () => {
    // Fixtures douradas: se o algoritmo de Meeus for mexido, isto acusa.
    expect(easterSunday(2024)).toEqual({ month: 3, day: 31 });
    expect(easterSunday(2025)).toEqual({ month: 4, day: 20 });
    expect(easterSunday(2026)).toEqual({ month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ month: 3, day: 28 });
  });
});

describe('calendario bancario nacional', () => {
  const cal = new BrazilianBankCalendar();

  it('fim de semana nao e dia util', () => {
    expect(cal.isBusinessDay('2026-08-29')).toBe(false); // sabado
    expect(cal.isBusinessDay('2026-08-30')).toBe(false); // domingo
    expect(cal.isBusinessDay('2026-08-28')).toBe(true); // sexta
  });

  it('feriados fixos nao sao dia util', () => {
    for (const data of ['2026-01-01', '2026-04-21', '2026-05-01', '2026-09-07', '2026-12-25']) {
      expect(cal.isBusinessDay(data), data).toBe(false);
    }
  });

  it('Carnaval e Sexta-feira Santa saem da Pascoa', () => {
    // Pascoa 2026 e 05/04. Carnaval cai em 16 e 17 de fevereiro; Sexta-feira
    // Santa em 03/04; Corpus Christi em 04/06.
    expect(cal.isBusinessDay('2026-02-16')).toBe(false);
    expect(cal.isBusinessDay('2026-02-17')).toBe(false);
    expect(cal.isBusinessDay('2026-04-03')).toBe(false);
    expect(cal.isBusinessDay('2026-06-04')).toBe(false);
  });

  it('Consciencia Negra so vale a partir de 2024', () => {
    // Lei 14.759/2023. Antes disso era feriado estadual em parte do pais, e
    // tratar como nacional retroativamente erraria a janela em 2023.
    expect(cal.isBusinessDay('2023-11-20')).toBe(true); // segunda-feira
    expect(cal.isBusinessDay('2024-11-20')).toBe(false);
  });

  it('o Carnaval encurta a distancia, e e por isso que o calendario existe', () => {
    // Sexta 13/02 -> quarta 18/02/2026. Segunda e terca sao Carnaval.
    //
    // So com fins de semana: 16, 17 e 18 contam = 3 dias uteis, e a janela de
    // 2 dias uteis do passe 3 RECUSARIA o par. Com o calendario nacional so o
    // 18 conta = 1, e o casamento legitimo acontece. A diferenca entre os dois
    // numeros e exatamente o valor deste arquivo.
    expect(new WeekendOnlyCalendar().businessDaysBetween('2026-02-13', '2026-02-18')).toBe(3);
    expect(cal.businessDaysBetween('2026-02-13', '2026-02-18')).toBe(1);
  });

  it('addBusinessDays pula feriado e fim de semana', () => {
    // Sexta + 1 dia util = segunda.
    expect(cal.addBusinessDays('2026-08-28', 1)).toBe('2026-08-31');
    // Antes do Natal de 2026 (sexta): 24 e quinta, entao -1 e 24.
    expect(cal.addBusinessDays('2026-12-28', -1)).toBe('2026-12-24');
  });

  it('anda para tras tambem', () => {
    expect(cal.addBusinessDays('2026-08-31', -1)).toBe('2026-08-28');
  });

  it('a distancia e simetrica', () => {
    expect(cal.businessDaysBetween('2026-08-28', '2026-08-31')).toBe(
      cal.businessDaysBetween('2026-08-31', '2026-08-28'),
    );
  });

  it('a mesma data dista zero', () => {
    expect(cal.businessDaysBetween('2026-08-28', '2026-08-28')).toBe(0);
  });

  it('24 e 31 de dezembro sao dia util por padrao', () => {
    // O que importa e quando o EXTRATO posta, e o provedor pode postar.
    expect(cal.isBusinessDay('2026-12-24')).toBe(true);
    expect(
      new BrazilianBankCalendar({ treatChristmasEveAsHoliday: true }).isBusinessDay('2026-12-24'),
    ).toBe(false);
  });
});

describe('calendario so de fins de semana', () => {
  const cal = new WeekendOnlyCalendar();

  it('ignora feriado, e isso e explicito', () => {
    // Existe para provedor cujo calendario nao conhecemos. Em producao o
    // nacional e o padrao.
    expect(cal.isBusinessDay('2026-12-25')).toBe(true);
    expect(cal.isBusinessDay('2026-12-26')).toBe(false); // sabado
  });

  it('conta e anda como o outro', () => {
    expect(cal.addBusinessDays('2026-08-28', 1)).toBe('2026-08-31');
    expect(cal.businessDaysBetween('2026-08-28', '2026-08-31')).toBe(1);
  });
});
