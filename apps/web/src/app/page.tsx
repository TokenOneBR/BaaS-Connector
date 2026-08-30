import { redirect } from 'next/navigation';

/** A raiz nao tem tela propria: o console comeca no painel de homologacao. */
export default function Root() {
  redirect('/HOMOLOGACAO/dashboard');
}
