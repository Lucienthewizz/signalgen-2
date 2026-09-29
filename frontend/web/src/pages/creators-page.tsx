import { ArrowLeft, ArrowUpRight, Github, UserRound } from "lucide-react";
import { Brand } from "@/components/brand";

const creators = [
  {
    name: "Tugus Agung",
    role: "Frontend programmer",
    github: "https://github.com/Darknqss",
    handle: "github.com/Darknqss",
  },
  {
    name: "Lucien Punawarman",
    role: "Backend programmer",
    github: "https://github.com/Lucienthewizz",
    handle: "github.com/Lucienthewizz",
  },
] as const;

export function CreatorsPage() {
  return (
    <main className="creators-page">
      <header className="creators-topbar">
        <a href="#home" aria-label="Signalgen home"><Brand compact /></a>
        <a href="#home"><ArrowLeft aria-hidden="true" /> Back to home</a>
      </header>
      <section className="creators-directory">
        <header>
          <h1>Creators</h1>
          <p>The people building Signalgen’s web workspace and service layer.</p>
        </header>
        <div className="creators-directory__list">
          {creators.map(({ name, role, github, handle }) => (
            <article key={name} className="creator-row">
              <div className="creator-row__portrait" aria-hidden="true">
                <UserRound />
              </div>
              <div className="creator-row__body">
                <h2>{name}</h2>
                <p>{role}</p>
                <a href={github} target="_blank" rel="noreferrer">
                  <Github aria-hidden="true" />
                  <span>{handle}</span>
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </div>
            </article>
          ))}
        </div>
        <p className="creators-directory__note">Signalgen is a research workspace for IDX analysis. Not investment advice.</p>
      </section>
    </main>
  );
}
