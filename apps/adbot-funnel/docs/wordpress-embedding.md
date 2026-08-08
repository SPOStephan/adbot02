# WordPress-Einbettung des Recruiting-Funnels

Der Recruiting-Funnel lässt sich entweder als **eigenständige Zielseite** verlinken oder als responsives `iframe` direkt in eine WordPress-Seite einbetten. Ersetzen Sie in den folgenden Beispielen `https://IHRE-FUNNEL-DOMAIN.de` durch die veröffentlichte Domain der Anwendung und `karriere` bei Bedarf durch den im Admin-Bereich konfigurierten Slug.

## Direkte Verlinkung

Die öffentliche URL folgt immer diesem Muster:

```text
https://IHRE-FUNNEL-DOMAIN.de/f/karriere
```

Diese Adresse kann als Ziel eines Buttons, einer Stellenanzeige, eines Social-Media-Posts oder eines QR-Codes verwendet werden.

## Responsive Einbettung in WordPress

Öffnen Sie die gewünschte Seite im WordPress-Blockeditor, fügen Sie einen Block **„Individuelles HTML“** ein und kopieren Sie den folgenden Code hinein:

```html
<iframe
  id="recruiting-funnel"
  src="https://IHRE-FUNNEL-DOMAIN.de/f/karriere"
  title="Karriere-Bewerbung"
  loading="lazy"
  style="width:100%;min-height:780px;border:0;border-radius:16px"
  allow="clipboard-write">
</iframe>
<script>
window.addEventListener("message", function (event) {
  if (event.origin !== "https://IHRE-FUNNEL-DOMAIN.de") return;
  if (event.data?.type !== "social-recruiting-funnel:resize") return;
  document.getElementById("recruiting-funnel").style.height = event.data.height + "px";
});
</script>
```

Der Funnel meldet seine aktuelle Dokumenthöhe an die WordPress-Seite. Dadurch wächst und schrumpft das `iframe` bei jedem Schritt, ohne einen inneren Scrollbalken zu erzeugen. Die Prüfung von `event.origin` verhindert, dass Nachrichten anderer Websites die Höhe verändern.

## WordPress-Systeme ohne Skripte in Inhaltsblöcken

Einige WordPress-Installationen oder Sicherheits-Plugins entfernen `<script>`-Tags aus Beiträgen. In diesem Fall kann zunächst nur das `iframe` mit einer festen Mindesthöhe eingebettet werden. Alternativ fügt die zuständige Administration den JavaScript-Teil einmalig über das Theme, ein Child-Theme oder ein vertrauenswürdiges Code-Snippet-Plugin ein.

## Freigaben und Fehlerdiagnose

Tragen Sie die vollständige WordPress-Domain im Admin-Bereich unter **Einstellungen → Erlaubte Einbettungs-Domains** ein, beispielsweise `https://www.unternehmen.de`. Verwenden Sie ausschließlich HTTPS. Prüfen Sie nach der Veröffentlichung den vollständigen Bewerbungsablauf auf Mobilgeräten und Desktop-Geräten sowie die Datenschutzerklärung und den Lebenslauf-Upload.

Wenn der Funnel nicht angezeigt wird, kontrollieren Sie zuerst, ob er im Admin-Bereich veröffentlicht ist, ob die öffentliche URL direkt erreichbar ist und ob ein Sicherheits-Plugin externe `iframe`-Quellen blockiert.
