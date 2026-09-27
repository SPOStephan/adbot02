import { connect } from "node:tls";

export type PublicHttpsProbe = {
  ok: boolean;
  reachable: boolean;
  certificateName: string;
  issuer: string;
  matchesHostname: boolean;
  looksLikeOldHoster: boolean;
  message: string;
};

export function certificateLooksLikeOldHoster(name: string, issuer: string): boolean {
  const hay = `${name} ${issuer}`.toLowerCase();
  return /kasserver|all-inkl|strato\.de|ionos|1und1|hosteurope|world4you|mittwald/.test(hay);
}

export function chromeHostReuseWarning(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  return (
    `Chrome merkt sich bei vielen Besuchern den alten Hoster — Warnung oder „zu oft weitergeleitet“. ` +
    `Nicht auf „unsichere Seite“ klicken: das landet auf dem alten Webspace (404 oder Schleife). ` +
    `Safari, Handy oder Chrome-Gastfenster prüfen die echte Adresse. ` +
    `Zuverlässig für alle Chrome-Nutzer: eine Subdomain, die beim Hoster noch nie als Website lag, ` +
    `statt einer wiederverwendeten wie ${host}.`
  );
}

export function describePublicHttpsProbe(input: {
  hostname: string;
  certificateName: string;
  issuer: string;
  matchesHostname: boolean;
  looksLikeOldHoster: boolean;
}): string {
  const host = input.hostname.trim().toLowerCase();
  if (input.looksLikeOldHoster) {
    return (
      `Die Adresse zeigt noch auf den alten Webspace (Zertifikat ${input.certificateName || "Hoster"}). ` +
      `CNAME prüfen und die Subdomain im Hoster vom Webspace lösen. ` +
      `Solange das so ist, sieht Chrome bei Kunden die Zertifikatswarnung. Nicht aktivieren.`
    );
  }
  if (input.matchesHostname) {
    return (
      `Im Internet liegt das richtige Zertifikat (${input.certificateName}). ` +
      chromeHostReuseWarning(host)
    );
  }
  return `Zertifikat lautet ${input.certificateName || "unbekannt"}, nicht ${host}. Noch nicht als Kampagnen-URL nutzen.`;
}

export async function probePublicHttpsCertificate(
  hostname: string,
): Promise<PublicHttpsProbe> {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  return await new Promise(resolve => {
    const socket = connect(
      {
        host,
        servername: host,
        port: 443,
        timeout: 8_000,
      },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        const certificateName = String(cert.subject?.CN ?? "").trim();
        const issuer = String(cert.issuer?.O ?? cert.issuer?.CN ?? "").trim();
        const alt = String(cert.subjectaltname ?? "");
        const matchesHostname =
          certificateName === host
          || alt.toLowerCase().includes(`dns:${host}`)
          || (certificateName.startsWith("*.") && host.endsWith(certificateName.slice(1)));
        const looksLikeOldHoster = certificateLooksLikeOldHoster(certificateName, issuer);
        resolve({
          ok: matchesHostname && !looksLikeOldHoster,
          reachable: true,
          certificateName,
          issuer,
          matchesHostname,
          looksLikeOldHoster,
          message: describePublicHttpsProbe({
            hostname: host,
            certificateName,
            issuer,
            matchesHostname,
            looksLikeOldHoster,
          }),
        });
      },
    );
    socket.on("error", error => {
      resolve({
        ok: false,
        reachable: false,
        certificateName: "",
        issuer: "",
        matchesHostname: false,
        looksLikeOldHoster: false,
        message: `HTTPS-Prüfung fehlgeschlagen: ${error.message}`,
      });
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve({
        ok: false,
        reachable: false,
        certificateName: "",
        issuer: "",
        matchesHostname: false,
        looksLikeOldHoster: false,
        message: "HTTPS-Prüfung hat nicht geantwortet.",
      });
    });
  });
}
