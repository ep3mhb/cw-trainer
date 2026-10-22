// CW Trainer — user manual, English. Rendered by build.mjs.
import { ABBREVIATIONS, GLOSSARY, HANDOVER_SIGNALS, KEY_TYPES, PROSIGN_MISTAKES, PROSIGN_NOTES, Q_CODES } from '../../src/data/reference.ts';
import { KOCH_ORDER, MORSE, PROSIGNS } from '../../src/core/morse.ts';

export const VERSION = '0.11.0';
const letters = Object.fromEntries(Object.entries(MORSE).filter(([c]) => /^[A-Z]$/.test(c)));
const digits = Object.fromEntries(Object.entries(MORSE).filter(([c]) => /^[0-9]$/.test(c)));
const punct = Object.fromEntries(Object.entries(MORSE).filter(([c]) => !/^[A-Z0-9]$/.test(c)));

export default {
  lang: 'en', dir: 'ltr', file: `CW-Trainer-User-Manual-EN-${VERSION}.pdf`,
  // The PDF's internal Title is what a search engine shows as the result
  // title, so it has to name the subject rather than only the product.
  docTitle: 'CW Trainer — Morse code (CW) user manual',
  ui: { contents: 'Contents', chapter: 'Chapter', figure: 'Figure', page: 'Page', version: `Version ${VERSION}` },
  cover: {
    title: 'CW Trainer', subtitle: 'User manual',
    leds: ['Koch course', 'Sending practice', 'Simulated QSO', 'On air with others'],
    meta: [
      `**Version ${VERSION}** · October 2026`,
      'The web application at **cw.mikroutik.com**',
      '© 2026 Mohammad Bahrololoum, ex EP2MHB',
    ],
  },
  chapters: [
    // ------------------------------------------------------------------ 1
    {
      title: 'Welcome',
      intro: [
        'CW Trainer is a web application for learning and practising Morse code (CW). It teaches you to copy by ear with the Koch method, measures your sending on a real key, lets you work a simulated operator through a complete contact, and — once you sign in — puts you on a shared virtual band where you can work other members, live, with your own key.',
        'This manual describes every part of the application as it stands in version ' + VERSION + '. You do not need to read it from front to back: Chapter 2 gets you started in five minutes, and the rest is there for when you want to know what a control does or why it behaves the way it does.',
      ],
      sections: [
        {
          title: 'What it is, and what it is not',
          blocks: [
            'Everything in the first six tabs — Receive, Send, QSO, Progress, Settings and Help — runs in your browser. No account is needed for any of it, and after the page has loaded once it works without any connection at all. Your progress is stored on the device you are using and nowhere else.',
            'There is one exception, and it is better named here than discovered later: the **final exam**, the one that completes the course and earns a certificate, is set and marked by the server. Chapter 4 explains how, and why it is the only part of your practice that leaves the device.',
            { t: 'note', label: 'What the server knows about you', text: 'The privacy notice at **www.mikroutik.com/privacy.html** lists everything the server holds, why, and for how long. It is written to be read rather than agreed to, and it is linked from Help → About as well.' },
            'Beyond that, only the **On air** tab talks to the server, and only after you sign in. Even there, no audio ever travels: your key-down and key-up moments are sent, and the tone is generated again in the other member’s browser. Nothing goes on the air in the radio sense. Two browsers are talking to each other, so no licence is needed for any of it.',
          ],
        },
        {
          title: 'Where to find it and what you need',
          blocks: [
            'Open **https://cw.mikroutik.com** in a current browser: Safari, Chrome, Edge or Firefox, on a computer, a tablet or a phone. Headphones or speakers are all you need to start; a key or paddle is optional, and Chapter 5 explains how to connect one.',
            { t: 'kv', items: [
              ['Computer', 'Any recent browser. A keyboard is a perfectly good paddle: `[` is dit and `]` is dah.'],
              ['Phone or tablet', 'The same page. The key pad on screen becomes a touch paddle — left half dit, right half dah.'],
              ['Sound', 'Wired headphones or the built-in speakers. Bluetooth is fine for listening but adds a delay that spoils sending practice (see 10.3).'],
              ['Account', 'Only for the On air tab and the final exam; managed under Settings. Name, email address and a password of at least ten characters; your callsign if you hold one.'],
            ] },
          ],
        },
        {
          title: 'Installing it like an app',
          blocks: [
            'The application installs on your home screen or dock and then opens without the browser furniture around it. It is the same application and the same stored progress either way; installing only changes how you reach it.',
            { t: 'steps', items: [
              '**iPhone or iPad:** open the page in Safari, tap the Share button, then “Add to Home Screen”.',
              '**Android:** Chrome shows an install prompt, or use the browser menu → “Install app”.',
              '**Desktop Chrome or Edge:** an install icon appears at the right of the address bar, or look under the browser menu for “Install CW Trainer”.',
            ] },
            { t: 'note', kind: 'warn', label: 'Working offline', text: 'Offline use needs the version served from the web address, not a file opened from your disk. Load the page once while connected and it works without a connection after that. If it does not, something is clearing your browsing data when the browser quits — “clear on exit” settings and some privacy extensions do this, and they take your practice history with them.' },
          ],
        },
        {
          title: 'How this manual is written',
          blocks: [
            'Names of tabs, buttons and controls appear in **bold** exactly as they read on screen. Keys you press are shown like <kbd>Shift</kbd>. Things sent in Morse are shown in `code`. Boxed notes carry three labels: a **tip** you can skip, a **note** worth reading once, and a **caution** that saves you from a real mistake.',
            'Amber is the colour of the panel: an amber lamp, badge or trace means “live” or “yours”; green means “good” or “connected”; red means “stop” or “something is wrong”.',
          ],
        },
      ],
    },
    // ------------------------------------------------------------------ 2
    {
      title: 'Getting started in five minutes',
      sections: [
        {
          title: 'The welcome page',
          blocks: [
            'The first time you open the application on a device, before any of the tabs, you are shown a page that says what this is. Behind the words a band scope runs, and a station on it is calling — CQ CQ DE CW TRAINER K — so the first Morse you meet here is Morse being sent and read, with the letters appearing above it as they go.',
            { t: 'fig', src: 'landing.png', n: 1, caption: 'The welcome page, shown once to a browser that has never been used here. The forty characters of the course are laid out beneath, with the two you begin with lit.' },
            'Beneath the band is the whole course: forty characters, K and M lit and the other thirty-eight waiting. It is an honest picture of the undertaking, and a more useful one than a sentence saying “forty characters”. Below that is one button, **Start lesson 1**, three short routes in for the three people who tend to arrive — somebody new to Morse, somebody returning after years away, somebody running a class — and the manual in its three languages.',
            { t: 'note', label: 'When you will and will not see it', text: 'It appears only on a browser holding no practice history, with nobody signed in — that is, only to somebody genuinely new to that device. Once you have answered a single drill you go straight to where you left off, as before. You can open it again whenever you like from **Help → About**, which is also how to show it to somebody else.' },
            'Opening it makes no request of any kind: no typeface fetched from elsewhere, no image, no counter. That is deliberate and it is checked before each release, because the privacy notice says that somebody without an account talks to nothing at all, and a welcome page is exactly the sort of page that quietly stops that being true.',
          ],
        },
        {
          title: 'First run',
          blocks: [
            { t: 'steps', items: [
              '**Press “Enable sound”** in the header. Every browser blocks audio until you interact with the page; this is that interaction. The Audio lamp turns green and reads “running”.',
              '**Go to Receive and press “Start session”.** You will hear only two characters, K and M, sent at a realistic speed with long gaps between them. That is deliberate — see Chapter 3.',
              '**Type what you heard, then press <kbd>Enter</kbd>.** Do not try to get all of it. Copy what you catch and let the rest go: chasing a character you missed usually costs you the next three.',
              '**Finish the ten drills.** At 90% or better a third character unlocks. Below that, run the session again.',
              '**Look at Progress.** The confusion matrix shows which characters you are mixing up. That is what to drill next.',
            ] },
            { t: 'fig', src: 'home-receive.png', n: 2, caption: 'Past the welcome page: the header plate with its three lamps, the row of tab keys, and the Receive tab.' },
            { t: 'note', kind: 'good', label: 'Tip', text: 'Fifteen minutes a day beats two hours on a Sunday. This is ear training, and ears learn from repetition spread out over days, not from cramming.' },
          ],
        },
        {
          title: 'The header plate',
          blocks: [
            { t: 'fig', src: 'header-plate.png', n: 3, caption: 'The header: application name, and the three readouts that are always visible.' },
            { t: 'kv', items: [
              ['Speed', 'Your current character speed and effective speed, as “18 / 8 WPM”. Change them on the Receive tab.'],
              ['Course', 'How many characters your course has unlocked so far, out of forty.'],
              ['Audio', 'The state of the sound engine. Green “running” is what you want. If it reads anything else, press the button beside it.'],
              ['Enable sound / Restart audio', 'The same button under two names. It says “Enable sound” until audio has started once, and “Restart audio” after that. Press it whenever the sound goes away — for example after changing headphones.'],
            ] },
          ],
        },
        {
          title: 'The tabs',
          blocks: [
            { t: 'fig', src: 'tabs.png', n: 4, caption: 'The seven tab keys. The lit one is where you are. An eighth, ADMIN, appears only for a signed-in administrator (6.12).' },
            { t: 'table', head: ['Tab', 'What it is for', 'Needs'], rows: [
              ['**Receive**', 'The Koch course and copying drills. This is where most of your time goes.', 'Nothing'],
              ['**Send**', 'Keying practice against a target, with a timing report on what you sent.', 'A key, or the keyboard'],
              ['**QSO**', 'A complete contact with a simulated operator, in band noise, typed or keyed.', 'Nothing'],
              ['**On air**', 'The virtual band: sign in, tune, call CQ, work other members live.', 'An account and a connection'],
              ['**Progress**', 'Everything the application has measured about you, with CSV export.', 'Nothing'],
              ['**Settings**', 'Audio, key mapping, and your data (export, import, delete).', 'Nothing'],
              ['**Help**', 'A shorter version of this manual, always at hand, with a clickable Morse chart.', 'Nothing'],
            ] },
            'The address bar remembers which tab you are on (`#receive`, `#air` and so on), so a bookmark to the On air tab opens straight onto the band.',
          ],
        },
      ],
    },
    // ------------------------------------------------------------------ 3
    {
      title: 'The Receive tab — learning to copy',
      intro: [
        'Receiving is the harder half of Morse and the half that matters first: you cannot work anyone you cannot copy. This tab teaches the forty characters of the course by sound alone, one at a time, at full speed from the first minute.',
        { t: 'fig', src: 'receive-session.png', n: 5, caption: 'A drill in progress. What was sent is shown afterwards with your copy marked against it.' },
      ],
      sections: [
        {
          title: 'The Koch method and the 90% rule',
          blocks: [
            'You start with two characters sent at full speed, and a third is added only once you are copying at 90% or better. By the end you know all forty — and you will never once have heard them slowly.',
            'The obvious alternative, learning all forty at a crawl and then speeding up, fails for a specific reason. Sent slowly, a character is a countable sequence: dit, dit, dit — that is three, that is S. Counting works up to about 10 words per minute and then hits a wall, because there is no longer time to count. Everyone who learns that way has to unlearn it, and unlearning is much harder than learning. Sent at full speed, a character has no countable parts. It is one sound, the way a spoken word is one sound rather than a row of letters.',
            'A session is ten drills. At the end, if you copied at least 90% of the characters correctly over at least 50 characters, you are offered an exam for the next character. Meeting the rule no longer adds the character by itself — it decides only that the question is worth asking. The threshold feels harsh when you land on 88%. It is protecting you: adding a character while two others are still shaky makes every later lesson harder, and the effect compounds.',
            { t: 'h3', text: 'Why the characters come in that order' },
            'Not alphabetical, and not shortest-first. The order deliberately puts easily-confused sounds close together early, so you learn to tell them apart while you have only a handful to think about — rather than meeting them for the first time at character thirty.',
            { t: 'pre', lines: [KOCH_ORDER.join('  ')] },
          ],
        },
        {
          title: 'The exam that adds a character',
          blocks: [
            'A good session used to add the next character on its own. It no longer does, for two reasons that are plain once stated.',
            'Stopping early can carry you past the rule. Three drills can easily pass fifty characters, so pressing **End session** while ahead could hand you a character you never asked for.',
            'And 90% is an average, and averages hide. At lesson 10 you have eleven characters; one of them copied at 40% is about 9% of the stream, so the session still scores around 92%. The broken character goes forward into every lesson after it, diluted further each time and so less likely ever to be caught. The rule got weaker exactly where the course got harder.',
            { t: 'fig', src: 'exam-offer.png', n: 6, caption: 'The offer at the end of a qualifying session. A panel, not a dialogue — it waits, and it does not block anything.' },
            'So a qualifying session now ends with an offer: your accuracy, the character on the table, and two buttons — **Take the exam for “X”** and **Stay with these**.',
            { t: 'note', kind: 'good', label: 'Declining costs nothing', text: 'Stay with these, and the offer comes back at the end of your next good session. It is not a one-time chance and it is not a nag. A member who wants to live on lesson 12 for a month is doing nothing wrong and should not have to argue with the application about it.' },
            { t: 'h3', text: 'What the exam is' },
            'It looks and sounds like ordinary drills. Each of your characters is sent **exactly four times**, shuffled into the usual groups of five. Nothing is grouped by character and nothing announces what is coming. At lesson 10 that is 44 characters; at lesson 39 it is 156.',
            'It passes only if **both** of these hold:',
            { t: 'ul', items: [
              'every character scores at least **three out of four**',
              'overall accuracy is at least **90%**',
            ] },
            'The first rule is the whole point: no character can hide behind the others. The second stops a pass built entirely of three-out-of-fours, which satisfies the first rule without being ready.',
            'Length is deliberately uncapped. Lesson 1 is 8 characters and lesson 39 is 156, because the cost should grow with how much there is to prove — and it is paid once per promotion, not once per session. A cap would have to spend its budget on some characters and not others, which is the hiding problem again in miniature.',
            { t: 'h3', text: 'Failing' },
            'Nothing is taken away and there is no waiting period. The result names the characters that let you down — “D, K and 7 came in under three out of four” — and those characters then **come up more often in your next drills** until they stop being a problem. A failed exam steers your practice instead of merely reporting on it.',
            { t: 'note', kind: 'warn', label: 'Stopping part-way', text: 'An exam that is stopped is abandoned, not marked. Half an exam cannot show that every character stands on its own, and scoring it would either fail you unfairly or pass you on a fragment. Nothing changes; start it again when you have time for the whole thing.' },
          ],
        },
        {
          title: 'Running a session',
          blocks: [
            { t: 'steps', items: [
              'Press **Start session**. A drill of the length set under “Drill length” (5 to 100 characters, default 25) is sent.',
              'Type what you heard in the copy box as you hear it, or afterwards, then press <kbd>Enter</kbd>. Case does not matter; spaces do not matter.',
              'The drill is shown with your copy marked against it: correct characters, wrong ones, and ones you missed. **Replay** sends the same drill again if you want to hear what you missed.',
              'The next drill starts by itself. After ten, the session ends with your accuracy for the session and, if you met the rule, a newly unlocked character.',
              '**End session** stops early. Drills you have finished still count toward your statistics, but an unfinished session does not unlock anything.',
            ] },
            'The readouts above the drill show the lesson, the drill number, the characters sent so far and your running accuracy.',
          ],
        },
        {
          title: 'What to practise',
          blocks: [
            'The course decides what you are ready for, but it does not have to decide what you practise. Under **What to practise** there are three choices:',
            { t: 'kv', items: [
              ['My course lesson', 'The normal choice and the only one that can unlock a character.'],
              ['Any lesson', 'Plays any lesson in the course, so you can hear what is coming or go back over an earlier set that still catches you out.'],
              ['My own set', 'Drills exactly the characters you type under “Characters to drill” — letters, digits, punctuation, or prosigns in angle brackets such as `<AR>`, separated however you like.'],
            ] },
            'Sessions on a lesson that is not your own, or on a set of your own, are **practice**: they are recorded and they feed the confusion matrix, but they leave your course position alone. Nobody wants to unlock six characters by accident while poking at lesson 30.',
            { t: 'note', label: 'Already know some Morse?', text: 'If the first lesson is wasting your time, choose “Any lesson”, set it to where you actually are, and press **Start my course here**. That moves your course position, and the 90% rule takes over from there.' },
          ],
        },
        {
          title: 'Speed: two numbers, not one',
          blocks: [
            '**Character speed** is how fast each character is sent. **Effective speed** is how fast the whole message goes once the gaps are counted. This application sets them separately, and the difference between them is the most useful single feature in learning to copy.',
            'The default is 18 WPM characters at 8 WPM effective. Each character arrives at the speed you are aiming for, so you learn its true rhythm — but a long silence follows, in which to recognise it and type it. This is **Farnsworth spacing**; the “Padded gaps / Standard timing” switch turns it on and off, and “Standard timing” simply sets the effective speed equal to the character speed.',
            { t: 'note', kind: 'good', label: 'Tip', text: 'As you improve, raise the effective speed and leave the character speed alone. You are shortening your own thinking time, not relearning anything. Once effective catches up with character speed, raise both together.' },
            { t: 'h3', text: 'Where the numbers come from' },
            'Speed is measured against the word PARIS, which takes exactly 50 dit-lengths to send including the space after it. So 20 words per minute means twenty PARIS-lengths a minute, and one dit is 1200 ÷ 20 = 60 milliseconds. A dah is three dits; the gap inside a character is one dit, between characters three, between words seven.',
          ],
        },
        {
          title: 'Leaving a series part-finished',
          blocks: [
            'A series is ten drills, and you do not have to do the ten in one sitting. The series is written down as you go, so reloading the page, closing the tab, or your telephone putting the page to sleep all leave you at the drill you had reached rather than back at the first. Come back within the day and you carry on.',
            'If you have asked for your records to be kept on the server (6.12), the series follows you between your own devices as well. Two drills on a laptop and eight on a telephone are one series of ten, and they earn the offer to move up exactly as ten in one place would. You are told when that happens rather than asked — it is your own work, and being made to approve it would be an irritation rather than a safeguard.',
            { t: 'note', label: 'What happens to a series you abandon', text: 'A series left alone for more than half a day stops being one you are in the middle of. It is closed and counted honestly as the short session it was — which means it will not earn a promotion, since that needs fifty characters in one session — and your next session starts fresh.' },
            'Where two devices have somehow been drilling the same series at once, the one with more drills done is the one that stands, and the other’s work is recorded as a session of its own rather than being thrown away. Nothing you have practised is ever discarded to settle a disagreement between two of your own machines.',
          ],
        },
        {
          title: 'Practising under real conditions',
          blocks: [
            'Every drill described so far is a perfect signal: a steady tone at a constant level, silence behind it, nobody else on the frequency, and timing exact to the millisecond because a machine produced it. Nothing on the air is like that.',
            'This matters more than it sounds. If the first imperfect signal you ever meet is a real one, on a real evening, you are likely to conclude that you cannot copy after all — when in fact you can copy perfectly well and have simply never practised anything else. So once you have unlocked ten characters, **Settings → Real conditions** appears and offers four departures from perfection, at two levels, together or one at a time.',
            { t: 'kv', items: [
              ['Fading', 'The signal rises and falls slowly, as a distant station does when the path between you shifts. It never disappears altogether — that would be a dropout, and copying through one teaches guessing rather than copying.'],
              ['Static', 'A low hiss with crashes over it. The crashes are the hard part: one can swallow a whole character, and the skill is carrying on rather than stopping to mourn it.'],
              ['Another station', 'A weaker station a few hundred hertz away, sending something else at a different speed. Learning to hold on to the one you want and let the other become background is a real skill, and a learnable one.'],
              ['A hand at the key', 'Elements and gaps that vary slightly, and a dah that runs a little long or a little short all evening, as one operator’s fist would. The variation is bounded so the sending stays readable: you are being given a human operator, not a broken one.'],
            ] },
            { t: 'note', kind: 'good', label: 'When to use them', text: 'A suggestion rather than a rule: leave conditions off while a character is new, and switch them on once a lesson feels comfortable. They are for consolidating what you already know, not for learning what you do not.' },
            { t: 'h3', text: 'Two things the application guarantees' },
            '**Examinations always run on a clean signal**, whatever you have set here — the per-character exam and the final exam both. A certificate has to mean the same thing for everyone who holds one, and it cannot if two members sat different examinations.',
            'And every session records **the level it was worked at**. Sessions under conditions score lower than clean ones; that is the whole point of them. Without that record your Progress tab would show a decline beginning the week you switched them on, which would be false — you would not be getting worse, you would be doing something harder.',
          ],
        },
      ],
    },
    // ------------------------------------------------------------------ 4
    {
      title: 'Finishing the course — the final exam and the certificate',
      intro: [
        'Thirty-nine of the forty characters are added by an exam your own browser sets and marks, and nothing about them leaves your device. The fortieth is different: the server sets that exam, marks it, and issues a certificate for it. This chapter is about that last step.',
      ],
      sections: [
        {
          title: 'Who can sit it',
          blocks: [
            'Anyone can sit the final exam and finish the course. A **certificate**, though, is issued to a member — so it needs an account on the server. The offer says so before you start rather than leaving you to discover it afterwards.',
            'If you would like one, sign in on the **On air** tab first. Sitting it signed out finishes the course and issues nothing, and there is no way to claim a certificate afterwards for an exam sat anonymously: the server has nobody to issue it to and no record that it was you.',
          ],
        },
        {
          title: 'How the exam reaches your browser',
          blocks: [
            'Worth understanding, because it explains why this one exam behaves unlike every other part of the application.',
            '**The server does not send the characters.** It generates the exam, converts it into a plain list of key-down and key-up durations, and sends only those numbers. Your browser plays tones from them and never learns what they spell. You type what you hear, and the server marks your answers against what it stored when it set the exam.',
            'So there is nothing in the page to read: the characters are not in the response, not in a variable, and not in an encrypted form the page could unlock. A locked box handed over together with its key is not locked, so none was sent.',
            { t: 'note', kind: 'good', label: 'Your sound is still your sound', text: 'Your own sidetone pitch and volume still apply, because your browser is still generating the tone. Only the timing comes from the server.' },
            'The exam is **160 characters** — all forty, four times each — in thirty-two groups of five. That is four or five minutes at ordinary speeds. The server holds it open for an hour.',
          ],
        },
        {
          title: 'The speed is yours, and it goes on the certificate',
          blocks: [
            'Both of your speeds are read from **Settings** at the moment the exam is set, and the server records what it sent at. Forty characters at 20/10 and forty at 25/25 are not the same achievement, so the certificate names both numbers rather than flattening them into one.',
            { t: 'note', kind: 'warn', label: 'Set the speed before you start', text: 'Changing the speed afterwards does not change an exam already in progress, and the certificate reports the speed the exam was actually sent at. If you want it to say something in particular, set it first.' },
          ],
        },
        {
          title: 'Passing, and failing',
          blocks: [
            'The rules are the same two as every other exam: **at least three out of four on every character**, and **at least 90% overall**. With forty characters there is simply more of it.',
            'Pass, and the course is complete and the certificate is drawn on the page straight away.',
            'Fail, and nothing is taken away. The result names the characters that came in under three of four, and you can sit it again whenever you like.',
            { t: 'note', label: 'If the submission cannot get through', text: 'A network failure after the exam is reported as what it is: the exam was sat and only the submission failed. That is worth distinguishing from the work having been thrown away, and the message says which happened.' },
          ],
        },
        {
          title: 'The certificate',
          blocks: [
            { t: 'fig', src: 'certificate-sheet.png', n: 7, caption: 'The certificate, as it appears on screen and prints. One A4 sheet, landscape, ink on white however the application is themed.' },
            'What is on it, all of it specific and checkable:',
            { t: 'kv', items: [
              ['Callsign or training identifier, and your name', 'As they stand on your account the day it is issued.'],
              ['The date', 'The day the final exam was passed.'],
              ['The speed', 'Character and effective WPM, as the exam was sent.'],
              ['The score', 'Out of 160.'],
              ['A serial number', 'Which is what makes it checkable by anyone else.'],
              ['A square', 'Which scans to the server’s own copy of the same facts.'],
            ] },
            'It is drawn in the page rather than handed to you as a file. **View and print** opens it and your browser’s own print dialogue turns it into paper or a PDF — one sheet, in landscape.',
          ],
        },
        {
          title: 'The public page, and switching it off',
          blocks: [
            'The square scans to a page on the server at `sig.mikroutik.com/certificate/<serial>`, which anyone holding the serial can open. It shows the **callsign, the date, the speed and the score — and nothing else**. Never your name, never your email.',
            'That is the trade, stated plainly: a serial nobody can check is not worth printing, and a page that can be checked is a page someone can read. Which is why you decide whether it answers at all.',
            'Under **Your account** on the **Settings** tab, each certificate carries **Withdraw from the public page**. Withdrawn, the page answers “not found” and the square stops resolving; **Publish it again** puts it back. Either way your printed copy is untouched — it is paper, and nothing on a server can reach it.',
            'The same row carries **View and print**, so a certificate can be opened again long after the tab you passed in was closed.',
          ],
        },
        {
          title: 'If you close your account',
          blocks: [
            'Closing your account deletes the exam and the certificate outright, and the verification page stops answering for that serial. Worth knowing before you close rather than after, since neither can be recovered.',
            { t: 'note', label: 'What the server keeps, and for how long', text: 'The final exam is the one part of your practice that reaches the server unless you ask for more: everything else — drills, settings, session history, statistics — stays in your browser, unless you switch on **training records** (chapter 7). The privacy notice says exactly what is held and for how long: **www.mikroutik.com/privacy.html**, also linked from Help → About.' },
          ],
        },
      ],
    },
    // ------------------------------------------------------------------ 5
    {
      title: 'The Send tab — keying practice',
      intro: [
        'The Send tab gives you a short target to send, listens to your key, decodes what you actually sent, and reports on your timing element by element. Nothing is transmitted; it is you, your key and an honest listener.',
        { t: 'fig', src: 'send-report.png', n: 8, caption: 'The Send tab after a run: target, what you sent, the figures, and the timing report.' },
      ],
      sections: [
        {
          title: 'Keys and paddles',
          blocks: [
            'What you own changes how you practise and how this application should be set. With no key at all, the bracket keys on your keyboard work: `[` for dit, `]` for dah — the convention of the VBand online keyer, so an adaptor already set up for VBand works here untouched. The left and right mouse buttons work too.',
            ...KEY_TYPES.flatMap((k) => [{ t: 'h4', text: k.name }, k.how, { t: 'note', text: k.inThisApp }]),
            { t: 'h3', text: 'Iambic mode A and mode B' },
            'This only matters with a dual-lever paddle, and only in one situation: you squeeze both levers and then release them. In **mode A** the keyer finishes the element it is sending and stops. In **mode B** it finishes that element and then sends one more, of the opposite kind. Neither is more correct. Pick one and stay with it — the muscle memory is specific to the mode, and switching later means sending stray characters for a week. Mode B is the more common default.',
            { t: 'h3', text: 'Getting a USB paddle adaptor working' },
            'Most inexpensive adaptors do not present themselves to the computer as a key or a keyboard. They appear as a mouse, and every dit becomes a real mouse click. This application accepts mouse buttons directly for exactly that reason, so many adaptors work with nothing to configure. The other common arrangement sends the bracket keys, which is the default here too. If neither works, **Settings → Key mapping → Set dit** captures whatever you press next, keyboard key or mouse button (see 8.2).',
          ],
        },
        {
          title: 'Sending a target',
          blocks: [
            { t: 'steps', items: [
              'Choose your **Key type** (straight key or iambic paddle) and, for a paddle, the **Iambic mode**.',
              'Press **Arm the key**. The keying area lights amber and reads “Ready — key now”; click it once so it has keyboard focus. Until the key is armed, nothing you press makes a sound — this keeps the bracket keys from sounding while you type elsewhere.',
              'Send the **Target** shown above the pad. **New target** gives you another; targets are drawn from the characters you have unlocked, so they never ask for a character you have not learnt.',
              'What the decoder reads appears under **What you sent** as you go, so you can see what a listener would have copied.',
              'Press **Analyse** for the report. **Clear** wipes the run and lets you start again; **Disarm** puts the key to sleep.',
            ] },
            'The **Decoder tolerance** slider sets how forgiving the decoder is when it decides whether a gap was inside a letter or between letters. Loose while you are starting out; tighten it as you improve so it starts holding you to real timing.',
          ],
        },
        {
          title: 'Reading your sending report',
          blocks: [
            'After keying, press Analyse. A row of figures comes back, then a report on your timing. They mean different things.',
            { t: 'kv', items: [
              ['Speed', 'What the application worked out you were sending at, measured from your own dit length.'],
              ['Weighting', 'Your dah divided by your dit. 3.00 is textbook. Consistently high means a heavy, deliberate fist, which is usually fine. Wildly varying means the dahs are not under control yet.'],
              ['Consistency', 'How even you were across the whole run. A station sending steadily at a slightly odd weight is easy to copy; one that is accurate on average but erratic element to element is hard work at the other end.'],
              ['Element gap / Char gap', 'The average gap you left inside a letter, and between letters. They are where most unreadable sending comes from, and the last thing anyone thinks to check.'],
              ['Match', 'How much of the target the decoder read back. 0% does not mean you cannot send — see the caution below.'],
            ] },
            { t: 'h3', text: 'The timing report' },
            'Below the figures, five rows — dit, dah, gap inside a letter, gap between letters, gap between words. Each is drawn twice: what standard Morse asks for, and what you actually sent, both with the length in milliseconds beside them. A row you did not send anything for says so rather than scoring you zero.',
            'The comparison is against **your own speed**, not the drill speed. Sending faster or slower than you were asked is not an error in itself — what makes sending readable is that the parts keep their proportions: a dah is three dits, the gap inside a letter is one, between letters three, between words seven. If you sent the whole thing at 25 WPM when the drill said 18, every row can still be green. The speed figure is where that shows up.',
            { t: 'note', label: 'Read this first', text: 'Above the rows is one sentence naming the most useful thing to fix. If it says your letters are running into each other, nothing else on the page matters until that is sorted: it is the fault that makes sending unreadable even when every dit and dah is perfect.' },
            { t: 'h3', text: 'Element by element' },
            'Under the report is a fold-out with one row per element of the target, grouped by letter. The pale bar is the ideal length, the solid bar is what you sent — green within 15%, amber within 35%, red beyond. Look for a pattern rather than individual misses: consistently short dahs is worth fixing, one stray dit is not. It pairs your elements with the target in order, so one extra or missing element shifts everything after it; when the counts differ it says so. Trust the five rows above it over this.',
            { t: 'note', kind: 'warn', label: 'Caution', text: 'If “Match” reads 0%, the decoder did not read back the target text. Either you sent something else — which is fine; the timing figures are still valid — or the tolerance is too tight for your fist. Loosen the tolerance slider before concluding you cannot send.' },
          ],
        },
        {
          title: 'The latency check',
          blocks: [
            'The **Latency check** panel on the Send tab shows how long your computer takes between the key closing and the tone starting. Under about 60 ms you stop noticing it; much above that you are practising against a delay that will not be there on the air.',
            'The first figures shown are the browser’s own estimate, and it says so: “this figure is not a measurement”. Press **Measure for real** to have the application play a tone through your speakers and time it with your microphone — this tells you whether a delay is really there or the browser is reporting a stale number. The two need very different responses (see 10.3).',
            { t: 'note', kind: 'warn', label: 'Bluetooth', text: 'Bluetooth headphones and speakers add 100–200 ms between your key and the tone, which no software can remove. They are fine for receiving practice, not for sending. The panel turns red and says so.' },
          ],
        },
      ],
    },
    // ------------------------------------------------------------------ 6
    {
      title: 'The QSO tab — a contact with a simulated operator',
      intro: [
        'A first contact is more ritual than conversation, which is good news: the shape is always the same, so you can learn it long before you can hold a conversation in Morse. The QSO tab runs that ritual with a simulated operator on a band with noise and fading — and it will repeat anything you miss.',
        { t: 'figrow', figs: [
          { src: 'qso-start.png', caption: 'Before the contact: choose the conditions and who calls.' },
          { src: 'qso-listening.png', caption: 'Listening for the CQ. Your reply goes in the box or on your key.' },
        ] },
      ],
      sections: [
        {
          title: 'The shape of a short contact',
          blocks: [
            { t: 'pre', lines: [
              'CQ CQ CQ DE A65XY A65XY K',
              '#      calling anyone at all. "DE" means "from".',
              '',
              'A65XY DE G4ABC G4ABC K',
              '#      someone answers: your call first, then theirs, then "over".',
              '',
              'G4ABC DE A65XY = GM ES TNX FER CALL = UR RST 579 579 =',
              'NAME HR MOHAMMAD MOHAMMAD = QTH DUBAI DUBAI = HW?',
              'G4ABC DE A65XY KN',
              '#      your turn: signal report, name, location. "=" is the BT separator,',
              '#      and things are sent twice because conditions are never perfect.',
              '',
              '#      ... the other station replies in the same shape ...',
              '',
              'G4ABC DE A65XY = TNX FER QSO = 73 ES CUL =',
              'G4ABC DE A65XY SK',
              '#      signing off. 73 is "best regards"; SK ends the contact for good.',
            ] },
            'Chapter 10 has the full list of Q codes, abbreviations and prosigns used here.',
          ],
        },
        {
          title: 'Setting up the contact',
          blocks: [
            'Under **Conditions**, before you start:',
            { t: 'kv', items: [
              ['Your callsign', 'What you will sign. Once you have signed in on the On air tab this is filled in for you with your callsign or training identifier.'],
              ['Who calls', '“They call CQ, I answer” (the default) or “I call CQ, they answer”. Not the same exercise — see below.'],
              ['Length', '“Short — report and out” or “Full — with a rag chew”.'],
              ['Their fist', '“Machine — perfect timing”, “Human — uneven, hesitant”, or “Variable speed”.'],
              ['Band conditions', 'Quiet, typical, poor or contest. Sets the noise floor, static and fading (QSB) under the other station.'],
              ['Receiver filter', '100 to 2400 Hz. Narrowing it quietens the band, exactly as it does on a real receiver.'],
              ['How you reply', '“Typing” or “On my key” — see 5.4.'],
            ] },
            'Then press **Listen for a CQ** (or **Open the band** if you are the one calling).',
          ],
        },
        {
          title: 'Answering, and calling',
          blocks: [
            'Calling is the harder half and the one worth practising. When you answer a CQ you have already heard the other callsign two or three times before you have to use it. When you call, the first thing that happens is a callsign you have never heard, sent once, in noise, with no warning — and you have to have it right, because everything after depends on it. That moment is why people listen for years without ever calling CQ.',
            'The station that answers sends its call twice and nothing else, exactly as a real answer does. If you do not get it, send `AGN`. Everyone does, including operators who have been doing this for forty years. The buttons **Ask for a repeat (AGN)** and **Ask for slower (QRS)** send those for you.',
            { t: 'h3', text: 'What the station you work is like' },
            'The station is invented on the spot, but not at random: its callsign, the name it gives and the town it gives all belong together. A station signing EA3 is in Spain and will be called something Spanish; one signing JA1 is in Japan. It greets you by the time of day where you are, and it thanks you only for what you actually sent — send it your report and it thanks you for the report; send it nothing but a greeting and it will not pretend otherwise. Once you have signed in and told it your name in the exchange, it uses your name.',
          ],
        },
        {
          title: 'Typing your reply, or keying it',
          blocks: [
            'Under **How you reply** you can send your side of the contact on your own key instead of typing it. What you key is decoded as you send, and shown above the pad — so you can see what the other station is about to hear before it goes.',
            'What the decoder reads is what gets sent. If your callsign comes out wrong, it goes out wrong and the other station answers the callsign you actually sent. That is the point: on the air nobody corrects your sending for you.',
            'A transmission ends when you stop. Leave the key alone for a couple of seconds and it goes, the way it does on the air — or press **Send it** if you would rather not wait. The pad is live only when it is your turn; while the other station is sending, your key is dead, so your own sidetone cannot play over the top of what you are trying to copy.',
            { t: 'note', text: 'Your key type and the iambic mode come from the Send tab, and the same keys and mouse buttons work here. Typing stays the default: copying is the harder half, and you should be able to practise contacts without a key plugged in.' },
            { t: 'h3', text: 'If you miss something' },
            'Send `AGN` (again) or `PSE RPT` (please repeat), and `QRS` if they are simply too fast for you. No competent operator minds in the slightest. Two habits worth having from the very first contact: send a little slower than you can receive, and send your callsign at the speed you want to be answered at.',
          ],
        },
      ],
    },
    // ------------------------------------------------------------------ 7
    {
      title: 'The On air tab — working other members',
      intro: [
        'This is the virtual band. You will not pick a member from a list. You will pick a frequency, and so will everyone else; tuning across the band you will hear signals arrive, rise to their proper pitch, and fade away again as you tune past — which means you can miss someone, exactly as on the air. Contacts are worked with your own key, live, and go into both stations’ logs.',
        { t: 'fig', src: 'air-contact.png', n: 9, caption: 'The On air tab during a contact: status lamps, the band scope with its waterfall, the VFO with tuning knob, the Heard list, your key, your log and your account.' },
      ],
      sections: [
        {
          title: 'Signing in and creating an account',
          blocks: [
            { t: 'fig', src: 'signin.png', n: 10, caption: 'The sign-in panel. “New here?” opens the registration form.' },
            'Live contacts need an account: a **name** (as you want it heard), an **email address** and a **password** of at least ten characters, plus your **callsign** if you hold one. Your password is never stored, only a one-way hash of it. A forgotten one is replaced through **Forgotten password**: a link is sent to your email that works once and for one hour.',
            { t: 'note', label: 'If the reset mail does not arrive', text: 'Look in your spam or junk folder before asking for another. The server sends from an address you have never written to, and some providers file a first message from one there; marking it as not spam keeps the next one in your inbox. The link works once and for one hour, so if an older one has expired, ask for a fresh one from **Forgotten password** rather than following the old mail.' },
            { t: 'h3', text: 'If you are not licensed yet' },
            'Leave the callsign blank. You will be given a **training identifier** that looks like a callsign so that copying it is the same exercise, but that no real station anywhere can ever hold: it begins **A0**, a series the ITU never issues, followed by your initials where they are free — so Anna Maria Rossi would be A0AMR. It is labelled “training” wherever it appears, contacts made under one are kept out of the ADIF export so nobody uploads practice to a real award by accident, and when you pass your licence your real callsign is added beside it.',
            { t: 'h3', text: 'Confirmation of your callsign' },
            'A callsign you claim is confirmed by an administrator before it counts as yours. Until then you can practise and go on the band, but your callsign is marked **unconfirmed** wherever it appears and no contact with you is exportable — so nobody can appear in another member’s log as an operator they are not. A training identifier needs no confirmation; the application issued it.',
            { t: 'note', text: 'If you sign in from a second device, the first is signed off the band — you cannot be on frequency twice. Nothing about your account is shared with anyone else, and the only web page allowed to talk to the server is this one.' },
          ],
        },
        {
          title: 'The status lamps',
          blocks: [
            'The row of badges at the top of the panel is your rig’s status line. Each has a lamp: amber for you, green for good, grey for off, red for a problem.',
            { t: 'kv', items: [
              ['You', 'Your callsign or training identifier, and “unconfirmed” or “training” where that applies.'],
              ['Band', '“on the band” with the round trip to the server in milliseconds; “reconnecting” while the connection is being rebuilt — wait for “on the band” before keying; “off” after you leave.'],
              ['On air', 'How many stations are on the band right now, including you.'],
              ['Dial', 'Your frequency.'],
              ['Contact', '“none”, “connecting…” while the direct channel is set up, “connected” during a contact, and a plain-words reason if it could not connect.'],
            ] },
          ],
        },
        {
          title: 'The band scope and waterfall',
          blocks: [
            { t: 'fig', src: 'scope.png', n: 11, caption: 'The band scope: spectrum along the top, waterfall beneath, the kHz scale along the bottom. The red line is your dial; the bright trace is a station keying.' },
            'The band scope is the band, **7 000 to 7 040 kHz**, drawn as an SDR draws it: a spectrum along the top and a waterfall beneath, scrolling down at a steady rate. A station shows as a peak on the spectrum and a bright trace on the waterfall **only while its key is down**, so you see the dits and dahs go by. The display shows the code being sent, not a carrier that never moves — a fake carrier would teach you to trust a picture over your ears. The noise floor rises and falls with the band conditions you choose.',
            'Each station carries its callsign above the glass. **Amber** means you can hear it from where your dial is; a **green ring** means it is calling CQ; the **red line** is your dial and the lighter strip either side of it is your receiver passband. Stations on or near the same frequency share one label — the strongest two by name and “+3” for the rest, as a pile-up — and the Heard list below names them all.',
            { t: 'ul', items: [
              '**Drag** across the glass to tune; the dial follows your finger or pointer.',
              '**Press a station’s marker** to land exactly on it.',
              'The legend under the glass names every colour used.',
            ] },
          ],
        },
        {
          title: 'The VFO: readout, knob and buttons',
          blocks: [
            { t: 'fig', src: 'vfo.png', n: 12, caption: 'The dial row: step buttons, the frequency readout, the Next buttons and, on the right, the tuning knob.' },
            { t: 'figrow', figs: [
              { src: 'knob.png', cls: 'tiny', caption: 'The tuning knob. The dimple turns with the frequency.' },
            ] },
            'The **tuning knob** beside the readout is the VFO. Drag round it and the dial follows the angle of your finger or pointer: one full turn is exactly 1 kHz, in a hundred 10 Hz detents, which is the feel of a modern rig at its fine step. The mouse wheel over the knob steps it too, as do the arrow keys when it has focus; hold <kbd>Shift</kbd> for 100 Hz steps and use <kbd>Page Up</kbd> / <kbd>Page Down</kbd> for 1 kHz.',
            { t: 'kv', items: [
              ['−10 / +10, −100 / +100, −1k / +1k', 'Step the dial by 10 Hz, 100 Hz or 1 kHz.'],
              ['◂ Next / Next ▸', 'A signal scan: jump the dial down or up to the **nearest other station you could hear** once tuned to it, landing exactly on its frequency. A station too weak for your receiver is skipped, so you never land on empty noise; one outside your current passband still counts, because finding what your ears cannot hear yet is the point. If there is nobody in that direction, nothing happens.'],
              ['The slider', 'Sweeps the whole band at once.'],
              ['The readout', 'Your frequency, as an operator says it: “7 018.90 kHz”. Focus it and the arrow keys step it (Shift for 100 Hz, Page keys for 1 kHz).'],
            ] },
            { t: 'note', kind: 'good', label: 'Tip', text: 'Use the Next buttons to hop from signal to signal along the scope, then the knob for the last few hertz. A station sounds at your sidetone pitch when you are tuned exactly onto it, higher when your dial is low, lower when it is high. Getting a station to sound right is **zero-beating**, and it is the skill this interface exists to teach.' },
          ],
        },
        {
          title: 'The Heard list',
          blocks: [
            { t: 'fig', src: 'heard.png', n: 13, caption: 'The Heard list during a contact: the other station with its signal bar, frequency, pitch and a plain-words strength, and the buttons for it.' },
            '**Heard** lists what is audible from where your dial is, loudest first, each with a signal bar (an S-meter), its frequency, the pitch it sounds at for you, and a plain-words report such as “loud and clear”. A station too weak or too far off your dial is simply not there, as on the air. Under the callsign is whatever the station put in its profile — name, QTH, rig — as it would send it in the exchange.',
            { t: 'kv', items: [
              ['Zero-beat', 'Puts your dial exactly on that station.'],
              ['Tune to', 'Shown for a caller who is off your dial. A CQ is meant to be found, so a station calling CQ is named even when you cannot hear it yet.'],
              ['Answer', 'Start a contact with that station (see 6.6).'],
              ['End contact', 'Replaces Answer during a contact.'],
              ['Report', 'Report the station to the administrators (see 6.11).'],
              ['Mute / Remove', 'Administrators only.'],
            ] },
            'The **link line** under a station you are in contact with tells you what the connection is doing: how many key movements arrived, how many were late, and the delay in use. It turns red when the delay reaches half a second or packets went missing. That is your network or theirs, in those words — never dressed up as poor conditions or left to look like bad sending.',
            { t: 'h3', text: 'Band conditions' },
            'The **Band conditions** choice under the Heard list puts the same noise floor and static under every station you hear, through the same receiver filter, so a contact is worked in noise rather than in a silent room. The fading (QSB) of the preset rides on every station, and the noise floor on the scope follows it. The stations themselves are at the level the Heard list shows for them.',
          ],
        },
        {
          title: 'Calling CQ, and answering',
          blocks: [
            { t: 'h3', text: 'To call' },
            { t: 'steps', items: [
              'Press **Find a clear spot**. The dial moves to a frequency with nobody near it.',
              'Press **Call CQ here**. Your key is armed, you are marked as calling (green ring on the scope), and the button reads “Calling CQ here”.',
              'Send `CQ CQ CQ DE <your call> <your call> K` on your key. Everyone on the band hears it at the pitch their own dial gives it.',
              'When someone answers, the contact connects by itself: the Contact lamp goes “connecting…” then “connected”, and their station appears in Heard with **End contact** beside it.',
            ] },
            { t: 'h3', text: 'To answer' },
            { t: 'steps', items: [
              'Find a station calling CQ — a green ring on the scope, or a row in Heard marked “calling CQ”. Press **Tune to** if you are not already on them.',
              'Press **Answer**. Your dial moves onto them, the direct connection is set up (a few seconds) and your key is armed.',
              'Send `<their call> DE <your call> <your call> K`, then work them as you would on the air: report, name, QTH, and so on (Chapter 6 has the shape).',
            ] },
            '**Listen here** puts you on the band at your current frequency without calling — you hear everyone, and everyone can see you on the scope, but your key stays disarmed. **End contact** closes a contact; it goes into both logs at once. **Leave the band** takes you off the air: nobody hears you and you hear nobody until you come back.',
            { t: 'fig', src: 'air-phone-heard.png', n: 14, cls: 'phone', caption: 'On a phone: a station calling CQ has been found with Next ▸ and appears in Heard with Answer.' },
          ],
        },
        {
          title: 'Your key, and over-to-over',
          blocks: [
            { t: 'fig', src: 'your-key.png', n: 15, caption: 'Your key during a contact: the turn lamp, the “your over” badge, and the armed pad.' },
            'The **Your key** panel is armed by Call CQ or Answer. Everyone on the band hears what you send; your contact hears it over the direct channel. The pad takes the same keys, mouse buttons and paddle as the Send tab, in the key type and iambic mode you set there.',
            'Contacts are **over to over**. A fifth of a second or more of buffering makes true break-in impossible, so the application holds your key while the other station is sending and for two and a half seconds after their last element. The pad turns amber and says **“Their over”**, and the lamp beside it shows whose over it is. Keying during the hold makes no sound and sends nothing; that is not a fault, it is the other station still sending. When the hold lifts the pad reads “Ready — key now” and the badge reads “your over”.',
            { t: 'fig', src: 'pad-their-over.png', n: 16, caption: 'The pad while the other station is sending.' },
            { t: 'h3', text: 'On a phone or tablet' },
            { t: 'figrow', figs: [
              { src: 'touch-pad.png', caption: 'The touch paddle: left half dit, right half dah.' },
              { src: 'send-phone.png', cls: 'phone', caption: 'The same pad on the Send tab.' },
            ] },
            'The key pad is your paddle: the **left half is dit, the right half dah**, and two thumbs squeeze exactly as two paddles do. In straight-key mode the whole pad is the key. The same pad works on the Send and QSO tabs.',
          ],
        },
        {
          title: 'What travels between you, and the delay',
          blocks: [
            'Not audio. Your key-down and key-up times are sent, and the tone is generated again in the other member’s browser at whatever pitch they prefer. Nothing is compressed, so nothing is distorted, and the whole contact costs a few bytes a second.',
            'Each side holds what arrives for about **200 ms** before sounding it, which is what lets the timing be rebuilt exactly and gives late packets time to arrive. When one is still late, it is played the moment it comes — never thrown away, because a missing element would sound like a sending error — and the delay is grown so the ones behind it are on time. Between overs the delay shrinks back if it can. On a good connection it stays at 200 ms; on a phone on wifi it may settle at half a second or more, and the first over of a contact will sound rough while it learns.',
            { t: 'note', label: 'Measured', text: 'On a wired connection, on home wifi, and between countries, the elements arrive exactly as sent — no error at all. On hotel wifi and on a phone they often do not arrive in time, and the application works around it as described. The link line in Heard shows you which case you are in. You should never be practising against a fist that the connection wrecked in transit.' },
            { t: 'h3', text: 'Phones, screen locks and reconnecting' },
            'Phones drop the connection to the server when the screen locks or you switch apps. When you come back the application reconnects at once, puts you back on your frequency, and ends any contact you were in — the other station has been told you left — so just call or answer again. If the Band lamp says “reconnecting”, wait for “on the band” before keying. The application checks the connection every fifteen seconds and reconnects by itself if the server has gone quiet, so a station that has really gone disappears from everyone’s band within about half a minute.',
          ],
        },
        {
          title: 'Your log, RST and ADIF export',
          blocks: [
            { t: 'fig', src: 'log.png', n: 17, caption: 'Your log with one contact: date, the other station, frequency, duration, and the three exchange boxes.' },
            'Both sides get the contact in their log automatically the moment it ends; **Your log** lists them, newest first. Each row has three boxes for the exchange: the **RST you sent**, the **RST you received**, and a **note**. Type `5NN` or `599`, either is accepted; the value is saved when you leave the box. These are your own account of the contact; the other station keeps theirs.',
            '**Export ADIF** downloads a file every logging program imports — one record per contact with the other station’s callsign, date and time in UTC, frequency, band, mode, and the RST and note if you wrote them. **Refresh** reloads the list from the server.',
            { t: 'note', text: 'Two things are deliberate. A contact with a training identifier stays in your log but is never exported, because A0 is not a callsign and no logging program should be handed it as one. And every exported record says in its comment that it was a practice contact on this virtual band, not an on-air QSO, so a log merged with your real one still tells the truth about each row. Contacts with an unconfirmed callsign are likewise withheld until it is confirmed.' },
          ],
        },
        {
          title: 'Reporting a problem with another station',
          blocks: [
            'An administrator can monitor an active contact and can mute or remove a member. You can report abuse from inside a contact without leaving it first: **Report** on a station’s row asks what happened and sends it to the administrators together with a transcript of what that station sent, decoded by your browser as a machine would copy it. Nothing you sent is included, and no transcript is kept or shown at any other time — copying by ear is the point.',
            'If an administrator has muted you, the You lamp and the key pad say so: “You are muted and cannot transmit at the moment.” A mute lasts 24 hours unless an administrator lifts it earlier.',
          ],
        },
        {
          title: 'For administrators',
          blocks: [
            { t: 'fig', src: 'admin-top.png', n: 19, caption: 'The ADMIN tab: members with callsigns awaiting confirmation first, then everyone else, then the deleted accounts folded away, then reports.' },
            'A member whose role is administrator sees an extra tab, **ADMIN**, at the end of the tab bar. It appears when such a member signs in on the On air tab and goes again when they sign out; no other member ever sees it. It carries an administrator’s four actions and nothing more:',
            { t: 'kv', items: [
              ['Confirm / Withdraw', 'Confirm a claimed callsign as the member’s own, or withdraw the confirmation. Members waiting on you are listed first and marked.'],
              ['Force reset', 'Sign the member out everywhere and mail them a password-reset link. The administrator never sees the link.'],
              ['Disable / Enable', 'Take an account off the band and out of use, or restore it. Removing a member from the band via their Heard row is the same as disabling.'],
              ['Unmute', 'Shown for a muted member, so a 24-hour mute can be lifted early.'],
              ['Delete', 'Empties the account and releases the callsign for someone else to register. Past contacts keep the callsign as text, so the other station’s log is not rewritten. Drawn in red, as the one action on the page that cannot be undone from it; asks twice.'],
              ['Reports', 'Listed under the members, open ones first, each with the transcript and a button to mark it dealt with.'],
            ] },
            'The line above the list counts members, not rows. A deleted account is not a member: the server empties the row and keeps it so that the moderation log and the contacts in other members’ logs still have something to point at. So three members and one deleted account read “3 members · 1 deleted”, and the deleted ones are folded away beneath the list, to be opened if you want to see them.',
            { t: 'note', kind: 'warn', label: 'Caution', text: 'Every action asks for a reason and is logged with it. Deletion cannot be undone.' },
            { t: 'note', text: 'Hiding the tab from everyone else tidies the interface and protects nothing. The protection is the server, which refuses every administrator’s request from an account that is not an administrator’s, whether or not the tab is on screen.' },
          ],
        },
      ],
    },
    // ------------------------------------------------------------------ 8
    {
      title: 'The Progress tab',
      intro: [
        { t: 'fig', src: 'progress.png', n: 20, caption: 'Progress: the summary tiles, effective speed over time, the confusion matrix, per-character accuracy and the histories.' },
      ],
      sections: [
        {
          title: 'What is measured',
          blocks: [
            { t: 'kv', items: [
              ['Sessions / Characters copied / Overall accuracy', 'Totals over everything you have done on the Receive tab.'],
              ['Characters unlocked', 'Your course position, out of forty.'],
              ['Best effective speed', 'The highest effective speed at which you completed a session.'],
              ['Effective speed over time', 'A chart of your sessions. Two or more are needed to draw a trend.'],
              ['Confusion matrix', 'A grid of what was sent (rows) against what you typed (columns). It turns “I keep making mistakes” into “I hear S as H”, which you can actually drill with “My own set”.'],
              ['Per-character accuracy, worst first', 'Each character with how often you copied it right. The top of this list is your next practice set.'],
              ['Session history / Sending history', 'Every receive session and every analysed sending run, with date, lesson, speeds, accuracy, weighting, consistency and latency.'],
            ] },
            '**Sessions CSV** and **Per-character CSV** download the tables for a spreadsheet.',
            { t: 'note', kind: 'warn', label: 'Where it lives', text: 'Progress lives in this browser, on this device, at this address. It does not follow you to another browser, and clearing your browsing data removes it. Export regularly from Settings — that file is the only backup that exists, unless you have switched on **training records** (chapter 7), in which case a summary of each session is also kept on the server and appears here as **Across your devices**.' },
          ],
        },
      ],
    },
    // ------------------------------------------------------------------ 9
    {
      title: 'The Settings tab',
      intro: [{ t: 'fig', src: 'settings.png', n: 21, caption: 'Settings: audio, key mapping and your data.' }],
      sections: [
        {
          title: 'Audio',
          blocks: [
            { t: 'kv', items: [
              ['Sidetone pitch', 'The tone you hear, in hertz. 500–700 Hz is usual. On the band, a station sounds at this pitch when you are zero-beat with it.'],
              ['Output volume', 'The application’s own level, separate from your device volume.'],
              ['Envelope rise and fall', 'How long each tone takes to rise and to fall, in milliseconds. Default 6 ms; the useful range is 4 to 8. Switching a tone on instantly sounds like a click at the start of every element, and an hour of that is tiring to copy. Measured on this application at 6 ms, the spread 1 kHz either side of the tone sits 84 dB below it; switched hard it would be 56 dB — nearly 300 times stronger. Past about 10 ms the edges start to soften the rhythm you are trying to hear.'],
              ['Weighting', 'The dah-to-dit ratio the application sends with. 3.0 is textbook; slightly heavier is often easier to copy.'],
              ['Latency warning above', 'The threshold, in ms, at which the Send tab’s latency panel turns red.'],
              ['Test — send V V V', 'Plays three Vs so you can check pitch and volume.'],
              ['Mute / Unmute', 'Silences the application without touching your device.'],
            ] },
          ],
        },
        {
          title: 'Real conditions',
          blocks: [
            'A panel of its own, and one you will not see at first: it appears once you have unlocked ten characters. Fading, static, another station and a hand at the key, at **off**, **mild** or **strong**, with each of the four switchable under that. 3.7 explains what each one does and why practising against them is worth the trouble; this is only where they live.',
            { t: 'note', label: 'It does not touch your examinations', text: 'Whatever is set here, the per-character exam and the final exam both play a clean signal. Nothing you choose on this panel can make your certificate mean something different from anybody else’s.' },
          ],
        },
        {
          title: 'Key mapping',
          blocks: [
            'The default is the VBand convention: `[` for dit, `]` for dah, and the left and right mouse buttons. **Set dit**, **Set dah** and **Set straight key** each capture whatever you press next — a keyboard key or a mouse button — and <kbd>Escape</kbd> cancels. **Restore VBand defaults** puts the brackets back.',
          ],
        },
        {
          title: 'Your data',
          blocks: [
            { t: 'kv', items: [
              ['Export everything', 'Writes a single file with your settings, course position and all history to your downloads. This is your backup.'],
              ['Import a file', 'Restores such a file — for example on a new computer.'],
              ['Roll up old data', 'Condenses drill-by-drill detail older than 30 days into summaries, keeping the statistics but shrinking the store. The application does this by itself once per load.'],
              ['Delete all local data', 'Removes everything stored on this device and reloads. It does not touch your On air account, nor any training records you have asked the server to keep — both live on the server, and are removed from Your account.'],
            ] },
          ],
        },
        {
          title: 'Your account: profile and password',
          blocks: [
            { t: 'fig', src: 'account.png', n: 18, caption: 'Your account on the Settings tab: profile fields, password change, training records and closing the account.' },
            'Your **profile** — QTH, grid square, rig, antenna, licence, preferred sidetone and target speed — lives under **Your account** on the **Settings** tab. It is the one place these are kept: the sidetone you save there becomes the sidetone this browser uses; the QSO tab’s robot addresses you by your own callsign or training identifier once you have signed in. On the band, whatever you filled in is shown under your callsign to anyone who can hear you, as you would send it in the exchange. Leave a field blank and nothing is shown. Press **Save profile** when done.',
            'To **change your password**, give the current one and a new one of at least ten characters, then press **Change password**. Changing or resetting it signs out every other device you were signed in on. **Sign out** at the very bottom leaves the band and forgets your session on this device.',
          ],
        },
        {
          title: 'Keeping your training records on the server',
          blocks: [
            'Everything you practise stays in the browser you practised in. That is the default, it is what the application has always done, and for most people it is right. It has one consequence: drill on a telephone and at a desk and you have two unrelated histories, neither of which is your progress — and clearing your browsing data takes the lot.',
            'So you may **ask** for a summary of each session to be kept on the server. It is off until you switch it on: there is a checkbox when you register, and a control under **Your account** afterwards. Having an account does not switch it on.',
            'Two things follow. Your **Progress** tab grows a panel called **Across your devices**, which is the same report drawn from every machine you practise on. And when you sign in somewhere else, the application takes whichever course position is further on — this browser’s or the server’s — so a lesson you unlocked on the train is where you begin at the desk. It never moves you backwards: a character you have unlocked stays unlocked, whichever machine earned it.',
            { t: 'kv', items: [
              ['What is sent', 'For each finished session: when it began and ended, the kind of drill, both speeds, how many characters it asked of you, how many you got right, and your course position at the time. Within the session, per character: how often it came up, how often you were right, and your total reply time for the ones you were right about. Also the characters a failed exam asked you to practise more.'],
              ['What is never sent', 'Your keystrokes. What you typed, character by character, stays in this browser and goes nowhere — it is the closest thing this application holds to a recording of somebody fumbling. Nothing from the Send tab or the band is included either.'],
              ['Who can see it', 'You. Not another member, and not an administrator.'],
              ['Switching it off', 'Deletes what the server holds, at once. The nightly backups are kept for fourteen days, so it leaves those within a fortnight. Switch it on again later and it starts empty.'],
              ['If you are offline', 'A session finished without a connection goes up the next time the application can reach the server. There is nothing to press, and nothing is lost in the meantime.'],
            ] },
            { t: 'note', label: 'Closing your account', text: 'Training records are deleted with the account, like the exam and the certificate. Your practice history in this browser is untouched.' },
          ],
        },
      ],
    },
    // ------------------------------------------------------------------ 10
    {
      title: 'Operating reference',
      sections: [
        {
          title: 'The Morse alphabet',
          blocks: [
            { t: 'note', kind: 'warn', label: 'Caution', text: 'Useful as a reference — but do not learn from this table. Reading Morse off a chart trains your eyes, and your ears then have to start from nothing. Learn each character by its sound, through the course. On the Help tab every tile in this chart plays itself when clicked.' },
            { t: 'h4', text: 'Letters' }, { t: 'morse', map: letters },
            { t: 'h4', text: 'Numbers' }, { t: 'morse', map: digits },
            { t: 'h4', text: 'Punctuation and symbols' }, { t: 'morse', map: punct },
            { t: 'h4', text: 'Prosigns' }, { t: 'morse', map: PROSIGNS, label: (c) => c.replace(/[<>]/g, '') },
            'A prosign is sent as one unbroken run with no gap inside — that is what makes it punctuation rather than two letters side by side. In writing they are shown with a bar over the top or, as here and in the application, in angle brackets.',
          ],
        },
        {
          title: 'Ending a transmission: K, KN, AR and SK',
          blocks: [
            'This is where nearly every beginner mistake happens, because all four mean roughly “I have stopped sending” and they are not interchangeable.',
            { t: 'table', head: ['Send', 'It means', 'Use it when'], mono: [0], rows: HANDOVER_SIGNALS.map((h) => [`**${h.signal}**`, h.means, h.sendItWhen]) },
            { t: 'note', kind: 'good', label: 'In one sentence', text: 'K after a CQ, KN for the rest of the contact, SK once at the very end.' },
            { t: 'h3', text: 'Every prosign, and when to send it' },
            { t: 'table', head: ['Prosign', 'Sound', 'Means', 'Send it when'], mono: [0, 1], rows: PROSIGN_NOTES.map((p) => [`**${p.name}**`, (PROSIGNS[p.token] ?? '').replace(/\./g, '·').replace(/-/g, '−'), p.meaning, p.when]) },
            { t: 'h3', text: 'Mistakes worth avoiding' },
            { t: 'ul', items: PROSIGN_MISTAKES },
          ],
        },
        {
          title: 'Q codes',
          blocks: [
            'Three-letter codes that ask a question with a “?” after them and state a fact without one. They exist because they are quick to send and mean the same thing in every language.',
            { t: 'table', head: ['Code', 'As a question', 'As a statement'], mono: [0], rows: Q_CODES.map((q) => [`**${q.code}**`, q.question, q.answer]) },
          ],
        },
        {
          title: 'Abbreviations',
          blocks: [
            'Vowels get dropped and common words get shortened, because every character costs time.',
            { t: 'table', head: ['Short', 'Meaning'], mono: [0], rows: ABBREVIATIONS.map((a) => [`**${a.short}**`, a.meaning]) },
          ],
        },
        {
          title: 'Keyboard shortcuts',
          blocks: [
            { t: 'table', head: ['Where', 'Key', 'Does'], mono: [1], rows: [
              ['Anywhere the key is armed', '[  /  ]', 'Dit / dah (paddle) — the VBand convention'],
              ['Anywhere the key is armed', 'Left / right mouse button', 'Dit / dah'],
              ['Receive, QSO (typing)', 'Enter', 'Submit your copy or your reply'],
              ['On air: readout or knob', '↑ ↓ ← →', 'Tune 10 Hz'],
              ['On air: readout or knob', 'Shift + arrows', 'Tune 100 Hz'],
              ['On air: readout or knob', 'Page Up / Page Down', 'Tune 1 kHz'],
              ['On air: knob', 'Mouse wheel', 'Tune 10 Hz per notch (Shift: 100 Hz)'],
              ['Settings: key mapping', 'Escape', 'Cancel a capture'],
            ] },
          ],
        },
      ],
    },
    // ------------------------------------------------------------------ 11
    {
      title: 'When something is not working',
      sections: [
        {
          title: 'Sound',
          blocks: [
            { t: 'h4', text: 'No sound at all' },
            'Press **Enable sound** in the header. Browsers block audio until you interact with the page, so this is not optional and it is not a fault. Check the Audio lamp reads “running”.',
            { t: 'h4', text: 'I changed headphones and the sound stopped' },
            'Connecting AirPods or any other Bluetooth output, or unplugging a monitor with speakers in it, can leave the browser’s audio still pointed at the device that went away. The application watches for this and rebuilds its audio automatically, which takes a second or two — you will see a message saying it reconnected. If it does not come back by itself, press **Restart audio** in the header.',
          ],
        },
        {
          title: 'Keys and paddles',
          blocks: [
            { t: 'h4', text: 'The paddle does nothing' },
            'Press `[` on your keyboard. If that makes a tone, the application is fine and the problem lies between the paddle and the computer — check the adaptor is enabled in whatever remapping utility you use. If `[` does nothing either, check you pressed **Arm the key** and then clicked the keying area so that it has keyboard focus.',
            { t: 'h4', text: 'On the band, my key makes no sound' },
            'Look at the pad. If it is amber and reads “Their over”, the other station is still sending or has just stopped, and the two-and-a-half-second hold is in force — wait. If the You lamp says you are muted, an administrator has muted you. If the Band lamp says “reconnecting”, wait for “on the band”.',
          ],
        },
        {
          title: 'Latency and Bluetooth',
          blocks: [
            { t: 'h4', text: 'The tone lags behind the key' },
            'Look at the latency panel on the Send tab; over about 60 ms it turns red. The usual cause is Bluetooth headphones or a Bluetooth speaker, which add 100–200 ms that no software can remove. Switch to wired output or the built-in speakers, then press **Enable sound** again.',
            { t: 'h4', text: 'The latency figure is stuck high after using Bluetooth headphones' },
            'Once Bluetooth headphones have been used, the browser keeps reporting their delay — over 200 ms — for the rest of its life, even with the headphones disconnected and the built-in speakers selected. Reloading the page does not clear it, and neither does closing the window.',
            { t: 'note', text: 'Quitting the browser completely does clear it. On a Mac that means <kbd>⌘Q</kbd>, not just closing the window — closing the last window leaves the application running. Measured on one Mac: 190 ms before a full quit, 8.9 ms after. Either way, press **Measure for real** first: it tells you whether the delay is genuinely there or the browser is simply reporting a stale number.' },
          ],
        },
        {
          title: 'The band',
          blocks: [
            { t: 'h4', text: '“Can’t reach the server”' },
            'The On air tab says this, with a **Retry** button, when the server does not answer at all — it is down, or you are offline. You are still signed in and nothing has been lost; press **Retry** when you think it is back. Every other tab works without the server, so practice carries on regardless.',
            { t: 'h4', text: 'I cannot hear the other station' },
            'Check three things in order. Is their callsign amber on the scope — if grey, they are outside your receiver’s reach: press Zero-beat or Tune to. Are you on the band — the Band lamp must read “on the band”. Has the other station been muted or left — the Heard list will not show a station that is not there.',
            { t: 'h4', text: '“could not connect”' },
            'That is the network between you and the server, never your sending — and the Contact lamp says so in words. Try again; if it persists, one of you is on a network that blocks the connection (some hotel and office networks do). The link line under the station shows how the connection is behaving.',
            { t: 'h4', text: 'The other station sounds choppy or late' },
            'Look at the link line: late and missing counts, and the delay in use. Red means the connection, not the operator. Phones on wifi and hotel networks are the usual cause; the application grows its buffer to cope, and the first over will sound rough while it learns.',
            { t: 'h4', text: 'I was in a contact and now it has ended by itself' },
            'Your phone locked or you switched apps, the connection dropped, and on return the application reconnected and ended the stale contact — the other station was told. Call or answer again.',
          ],
        },
        {
          title: 'Data',
          blocks: [
            { t: 'h4', text: 'My progress has disappeared' },
            'Progress lives in this browser, on this device, at this address. It does not follow you to another browser, and clearing your browsing data removes it. Export regularly from Settings — that file is the only backup that exists. If you have one, **Import a file** restores it.',
            { t: 'h4', text: 'It will not work offline' },
            'See 1.3: load it once from the web address while connected, and check nothing is clearing your browsing data on quit.',
          ],
        },
      ],
    },
    // ------------------------------------------------------------------ 12
    {
      title: 'Glossary',
      sections: [
        {
          title: 'Every term the application puts on screen',
          blocks: [
            { t: 'dl', items: GLOSSARY.map((g) => [g.term, g.definition]) },
            { t: 'dl', items: [
              ['Zero-beat', 'Tuning your dial exactly onto another station, so it sounds at your own sidetone pitch. The skill the On air tab teaches.'],
              ['Passband', 'The slice of the band your receiver filter lets through, shown as the lighter strip either side of your dial on the scope.'],
              ['Waterfall', 'The scrolling picture of the band over time under the spectrum: bright where a signal is keying, dark where there is only noise.'],
              ['Training identifier', 'An A0 identifier issued to a member without a licence, so that copying it is the same exercise as a callsign. Never a real callsign; never exported.'],
              ['Over', 'One station’s turn to transmit. Contacts on the band are over to over: your key is held while the other station sends.'],
              ['ADIF', 'Amateur Data Interchange Format — the plain-text log format every logging program imports.'],
              ['Pile-up', 'Several stations on or near one frequency. The scope labels the strongest two and counts the rest.'],
            ] },
          ],
        },
      ],
    },
  ],
};
