"""Deterministic pre-retrieval guardrails.

Declines target individual matters (a named or specific student or staff member),
executive-session content, legal advice, endorsements and requests to recommend a
closure. Aggregate questions ("How many students are in grades K-6 at Warren?",
"What is the student attendance rate?") and questions about what the record says
("Is Fayston going to close?") pass through to the record.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum


class Category(StrEnum):
    STUDENTS = "students"
    PERSONNEL = "personnel"
    EXECUTIVE_SESSION = "executive_session"
    LEGAL = "legal"
    ENDORSEMENT = "endorsement"
    CLOSURE_RECOMMENDATION = "closure_recommendation"
    HOMES = "homes"


@dataclass(frozen=True)
class Guardrail:
    category: Category
    text: str
    follow_up_suggestions: tuple[str, ...]

    @property
    def answer_kind(self) -> str:
        return "homes_redirect" if self.category is Category.HOMES else "declined"


def _rx(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE | re.VERBOSE)


_RELATIVE = r"(?:child|children|son|daughter|kid|kids|student|grandchild|grandson|granddaughter|stepson|stepdaughter)"
_STAFF = (r"(?:teacher|principal|superintendent|assistant\ superintendent|coach|staff\ member|employee|para"
          r"|paraeducator|aide|bus\ driver|nurse|counselor|custodian|secretary|administrator|librarian)")
_PERSONAL_RECORD = (r"(?:iep|504(?:\ plan)?|disciplin\w*|suspen\w*|expel\w*|detention|report\ cards?"
                    r"|grades?\ (?:in|on|for)|test\ scores?|behaviou?r|records?|diagnos\w*|special\ ed\w*"
                    r"|bull(?:y|ied|ying)|incidents?|placement|evaluation)")

_STUDENT_RULES = [
    # A named or otherwise identified student.
    _rx(r"\b(?:student|child|kid|pupil|boy|girl|son|daughter)s?\ (?:named|called)\b"),
    _rx(r"\b(?<!per\ )(?<!each\ )(?:specific|individual|particular|certain|one)\ (?:student|child|pupil|kid)\b"),
    _rx(r"\bwhich\ (?:student|child|kid|pupil)\ (?:was|is|got|did|has)\b"),
    _rx(r"\bwho\ (?:was|were|got|has\ been)\ (?:suspended|expelled|disciplined|bullied|arrested|hurt|injured)\b"),
    # A family's own case: "my son's IEP", "our daughter was suspended".
    _rx(rf"\b(?:my|our|his|her|their)\ {_RELATIVE}(?:'s|s'|s)?\b.*\b{_PERSONAL_RECORD}\b"),
    _rx(rf"\b{_PERSONAL_RECORD}\b.*\b(?:for|of|about)\ (?:my|our|his|her|their)\ {_RELATIVE}\b"),
    _rx(r"\b(?:iep|504\ plan)s?\ (?:for|of)\ (?:my|our|his|her|their|[a-z]+'s)\b"),
    # Case-sensitive: an IEP or record for a capitalized given name.
    re.compile(r"\b(?:IEPs?|504 [Pp]lans?|records|grades|discipline)\s+(?:for|of)\s+[A-Z][a-z]+\b"),
]

_PERSONNEL_RULES = [
    _rx(rf"\b(?:fire|fired|firing|dismiss\w*|terminat\w*|reprimand\w*|disciplin\w*|investigat\w*|put\ on\ leave"
        rf"|placed\ on\ leave|misconduct|complaints?\ (?:about|against)|evaluat\w*|performance|resign\w*|quit|let\ go)"
        rf"\b.{{0,60}}\b(?:the|our|my|this|that|her|his|their)\ (?:[\w-]+\ )?{_STAFF}\b(?!s)"),
    _rx(rf"\b(?:the|a|our|my|this|that)\ (?:[\w-]+\ )?{_STAFF}\b(?!s).{{0,60}}"
        rf"\b(?:fired|dismissed|terminated|disciplined|investigated|reprimanded|resigned|quit|let\ go|on\ leave"
        rf"|performance|evaluation|incompetent|misconduct)\b"),
    _rx(rf"\b{_STAFF}s?\ (?:named|called)\b"),
    _rx(r"\b(?:mr|mrs|ms|mx|dr)\.?\ [a-z]+\b.{0,60}\b(?:good|bad|competent|incompetent|fired|disciplined|performance"
        r"|evaluation|on\ leave|resign\w*|quit|complaints?)\b"),
    _rx(rf"\bis\ (?:the|our|my)\ (?:[\w-]+\ )?{_STAFF}\ (?:good|bad|competent|incompetent|doing\ a)"),
    _rx(rf"\bwhy\ did\ (?:the|our|my|a)\ (?:[\w-]+\ )?{_STAFF}\ (?:leave|quit|resign|get\ fired|retire)"),
]

_EXEC = r"(?:executive|exec\.?|closed)[\s-]+sessions?|behind\ closed\ doors|in\ camera"
_EXEC_CONTENT = (r"(?:discuss\w*|said|say|says|talk\w*|happen\w*|transcripts?|recordings?|summar\w*"
                 r"|contents?|told|inside|went\ on|decid\w*|details?|about|why|who|learn\w*|reveal\w*|leak\w*|topics?)")
_EXEC_RULES = [
    _rx(rf"\b(?:{_EXEC})\b.*\b{_EXEC_CONTENT}\b"),
    _rx(rf"\b{_EXEC_CONTENT}\b.*\b(?:{_EXEC})\b"),
]

_LEGAL_TERM = r"(?:legal(?!\ (?:fees|costs|services|expenses|budget|counsel))|illegal|lawful|unlawful|a\ violation)"
_LEGAL_RULES = [
    _rx(r"\blegal\ (?:advice|opinion|options|recourse)\b"),
    _rx(r"\b(?:should|can|could)\ (?:i|we)\ (?:sue|file\ (?:a\ )?(?:lawsuit|suit|legal\ complaint|grievance))\b"),
    _rx(r"\b(?:sue|suing)\ (?:the\ )?(?:district|board|school|huusd|superintendent)\b"),
    _rx(rf"\b(?:is|was|are|were)\ (?:it|this|that|the\ board|the\ district|huusd|they)\b.{{0,60}}\b{_LEGAL_TERM}\b"),
    _rx(r"\bviolat\w*\b.{0,40}\b(?:law|statute|open\ meeting|constitution|title\ ix|ferpa|ada)\b"),
    _rx(r"\b(?:my|our)\ (?:legal\ )?rights\b"),
    _rx(r"\b(?:do|should)\ (?:i|we)\ need\ (?:a|an)\ (?:lawyer|attorney)\b"),
    _rx(r"\b(?:hire|get|talk\ to|contact)\ (?:a|an)\ (?:lawyer|attorney)\b"),
    _rx(r"\bgrounds\ (?:for|to)\ (?:a\ )?(?:sue|lawsuit|appeal|complaint)\b"),
]

_ENDORSEMENT_RULES = [
    _rx(r"\b(?:who|which\ candidates?)\ should\ (?:i|we)\ vote\ for\b"),
    _rx(r"\bhow\ should\ (?:i|we)\ vote\b"),
    _rx(r"\bshould\ (?:i|we|voters|people)\ vote\ (?:for|against|yes|no|on)\b"),
    _rx(r"\b(?:do|would|will|can)\ you\ (?:endorse|support|oppose|recommend|favou?r)\b"),
    _rx(r"\b(?:your|you)\ (?:personal\ )?(?:opinion|view|stance|position|endorsement)\b"),
    _rx(r"\bwhat\ do\ you\ (?:think|feel)\ (?:of|about)\b"),
    _rx(r"\bare\ you\ (?:for|against|in\ favou?r)\b"),
    _rx(r"\b(?:is|was)\ (?:board\ member|the\ chair|the\ superintendent)\b.{0,40}\b(?:good|bad|right|wrong)\b"),
]

_CLOSE = r"(?:clos\w*|shut\w*|consolidat\w*|merg\w*|shutter\w*)"
_SCHOOL_NAMES = r"(?:fayston|moretown|waitsfield|warren|brookside|crossett\ brook|harwood|thatcher\ brook)"
_CLOSURE_RULES = [
    _rx(rf"\bwhich\ (?:school|schools|campus|campuses|building|buildings|one|ones)\b.{{0,40}}\b(?:should|ought\ to"
        rf"|needs?\ to|must|deserves?\ to|would\ you|do\ you)\b.{{0,30}}\b{_CLOSE}"),
    _rx(r"\bshould\ (?:the\ board|the\ district|huusd|we|they|the\ community|voters)\ (?:vote\ to\ )?"
        r"(?:close|shut|consolidate|merge)\b"),
    _rx(r"\bshould\b(?:\ [\w-]+){1,5}\ (?:be\ )?(?:closed|shut\ down|shuttered|consolidated|merged)\b"),
    _rx(rf"\bshould\ {_SCHOOL_NAMES}\b.{{0,30}}\b(?:close|shut|stay\ open|remain\ open|consolidate|merge)\b"),
    _rx(rf"\b(?:you|your)\b.{{0,30}}\b(?:recommend\w*|suggest\w*|advi[sc]\w*|pick|choose|think)\b.{{0,60}}\b{_CLOSE}"),
    _rx(rf"\b{_CLOSE}\b.{{0,60}}\b(?:do|would|should)\ you\b"),
    _rx(rf"\b(?:best|better|wisest|smartest)\ (?:school|option|choice|one|campus)s?\ to\ {_CLOSE}"),
    _rx(rf"\b{_CLOSE}\b.{{0,60}}\b(?:best\ (?:option|choice|idea)|right\ (?:choice|call)|good\ idea|bad\ idea"
        rf"|a\ mistake)\b"),
    _rx(rf"\b(?:if\ you\ (?:were|had\ to)|would\ you)\b.{{0,60}}\b{_CLOSE}"),
]

_SCHOOL_TERMS = _rx(r"\b(?:schools?|huusd|district|enrol\w*|students?|education\w*|board|teachers?|grades?"
                    r"|classrooms?|kindergarten|preschool|pre-?k|harwood|brookside|crossett|nesdec|reconfigur\w*"
                    r"|tuition|budget)\b")
_HOUSING_TERMS = _rx(r"\b(?:parcels?|short[-\ ]term\ rentals?|strs?|airbnbs?|vrbos?|de-?homestead\w*|homestead\w*"
                     r"|grand\ list|property\ (?:taxe?s?|assessments?|values?|records?)|assessed\ values?"
                     r"|appraisals?|housing|home\ (?:prices|values|sales)|rents?|rentals?|dwellings?|second\ homes?"
                     r"|vacation\ homes?|zoning|listers?|landlords?|vacancy\ rates?)\b")

_DECLINE_FOLLOW_UPS = ("What do the public reconfiguration reports say?",
                       "How has HUUSD enrollment changed?", "Show recent HUUSD Board minutes")

_DECLINES: list[tuple[Category, list[re.Pattern[str]], str]] = [
    (Category.EXECUTIVE_SESSION, _EXEC_RULES,
     "I can't describe what happens in executive session. Those discussions are confidential, and Open Valley "
     "does not collect them. Public minutes may record that a session occurred and its general purpose; I can "
     "help you find those minutes."),
    (Category.STUDENTS, _STUDENT_RULES,
     "I can't help with questions about an individual student. Please contact the school or the HUUSD central "
     "office, which can handle student matters confidentially. I can answer questions about district-wide or "
     "school-wide figures, such as enrollment."),
    (Category.PERSONNEL, _PERSONNEL_RULES,
     "I don't discuss individual staff members or personnel matters. Concerns about a staff member should go "
     "to the building principal or the superintendent's office. I can help with public staffing reports and "
     "budgets."),
    (Category.LEGAL, _LEGAL_RULES,
     "I can't give legal advice or judge whether something is legal. Please consult a lawyer. I can point you "
     "to the public policies, minutes and reports in the record."),
    (Category.CLOSURE_RECOMMENDATION, _CLOSURE_RULES,
     "I don't recommend whether or which schools should close. I can show what the public record contains "
     "about reconfiguration options, enrollment and facilities, and what the board has or hasn't decided."),
    (Category.ENDORSEMENT, _ENDORSEMENT_RULES,
     "I don't take positions or endorse candidates, votes or proposals. I can show what the public record "
     "says so you can decide for yourself."),
]

HOMES_TEXT = ("This assistant covers HUUSD schools and the Schools public library. Open Valley's Homes "
              "coverage of parcels, homestead filings and short-term rentals is still being worked on. "
              "See [Homes](/homes) for what is available now.")


def normalize(question: str) -> str:
    return re.sub(r"\s+", " ", question.replace("’", "'").replace("‘", "'")).strip()


def check(question: str) -> Guardrail | None:
    """Return a canned response for out-of-scope questions, or None to answer from the record."""
    text = normalize(question)
    for category, rules, message in _DECLINES:
        if any(rule.search(text) for rule in rules):
            return Guardrail(category, message, _DECLINE_FOLLOW_UPS)
    if _HOUSING_TERMS.search(text) and not _SCHOOL_TERMS.search(text):
        return Guardrail(Category.HOMES, HOMES_TEXT, ())
    return None
