import { useDashboard } from '../dashboard.jsx';
import { Ref } from './Ref.jsx';

export function Agents() {
  const { state: s } = useDashboard();
  const max = s?.loop.maxAgents || 3;
  const running = (s?.items ?? []).filter((i) => i.agent_id);
  const finished = (s?.finishedToday ?? []).slice().reverse();
  return (
    <section className="panel" id="agents" aria-labelledby="h-agents">
      <div className="head"><h2 id="h-agents">Agents</h2><span className="muted small">{s ? `${running.length} of ${max} slots busy` : ''}</span></div>
      <div className="body">
        <div className="slots" style={{ gridTemplateColumns: `repeat(${max}, minmax(0, 1fr))` }}>
          {Array.from({ length: max }, (_, k) => <span key={k} className={`slot${k < running.length ? ' on' : ''}`} />)}
        </div>
        <div className="list">
          {running.map((i) => (
            <div className="agent" key={i.id}>
              <span className="g wait">running</span>
              <div className="main"><span className="body-sm">{i.agent_id}</span><Ref item={i} actions={[]} /></div>
            </div>
          ))}
        </div>
        <div className="sec">Finished today</div>
        <div className="list">
          {s && !finished.length && <div className="muted body-sm">Nothing yet.</div>}
          {finished.map((f) => (
            <div className="agent" key={f.id}>
              <span className={`g ${f.status === 'done' ? 'ok' : 'bad'}`}>{f.status ?? 'done'}</span>
              <div className="main">
                <span className="body-sm wrap">{f.message.replace(/^\S+ \w+: /, '')}</span>
                {f.item && <Ref item={s.items.find((i) => i.id === f.item.id) ?? f.item} actions={[]} />}
                {f.commits?.length > 0 && <span className="mono muted tiny">{f.commits.map((c) => String(c).slice(0, 8)).join(' · ')}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
