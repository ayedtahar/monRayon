#!/usr/bin/env bash
#
# Refuse qu'un secret entre dans l'historique ou parte vers un serveur.
#
#   scripts/check-secrets.sh --staged          ce qui va etre commite
#   scripts/check-secrets.sh --range A B       les commits de A a B, avant un push
#   scripts/check-secrets.sh --all             tout l'historique
#
# Trois controles cumules, jamais alternatifs :
#
#   1. aucun fichier d'environnement suivi, sauf .env.example ;
#   2. detection par motifs de prefixe, toujours executee ;
#   3. gitleaks en supplement quand il est installe.
#
# Les deux derniers se completent plutot qu'ils ne se doublent. La regle
# OpenAI de gitleaks, par exemple, exige le marqueur « T3BlbkFJ » present
# dans les cles classiques : une cle d'une autre forme lui echappe, alors
# que le motif de prefixe l'attrape. A l'inverse gitleaks couvre des dizaines
# de fournisseurs et l'entropie, hors de portee d'un grep.
#
# Aucune valeur trouvee n'est affichee : un secret ne doit pas fuiter une
# seconde fois dans un journal de console ou une capture d'ecran.

set -uo pipefail

MODE="${1:---staged}"
FROM="${2:-HEAD}"
TO="${3:-HEAD}"

RED=$'\033[31m'; YEL=$'\033[33m'; GRN=$'\033[32m'; OFF=$'\033[0m'
[ -t 2 ] || { RED=; YEL=; GRN=; OFF=; }
fail() { printf '%s %s\n' "${RED}REFUSE${OFF}" "$*" >&2; }

FAILED=0

# --- 1. Fichiers d'environnement ------------------------------------------
# .gitignore les couvre, mais « git add -f » passe outre.

case "$MODE" in
  --staged) FILES=$(git diff --cached --name-only --diff-filter=ACMR) ;;
  --range)  FILES=$(git diff --name-only --diff-filter=ACMR "$FROM" "$TO") ;;
  *)        FILES=$(git ls-files) ;;
esac

ENV_FILES=$(printf '%s\n' "$FILES" | grep -E '(^|/)\.env' | grep -v '\.env\.example$' || true)
if [ -n "$ENV_FILES" ]; then
  fail "un fichier d'environnement va etre enregistre :"
  printf '%s\n' "$ENV_FILES" | sed 's/^/    /' >&2
  printf '    Seul .env.example a sa place dans le depot.\n' >&2
  printf '    Retirez-le : git rm --cached <fichier>\n' >&2
  FAILED=1
fi

# --- 2. Motifs de prefixe (toujours) --------------------------------------

PATTERNS='sk-[A-Za-z0-9_-]{20,}'
PATTERNS="$PATTERNS"'|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}'
PATTERNS="$PATTERNS"'|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}'
PATTERNS="$PATTERNS"'|xox[baprs]-[A-Za-z0-9-]{10,}'
PATTERNS="$PATTERNS"'|AIza[0-9A-Za-z_-]{35}'
PATTERNS="$PATTERNS"'|glpat-[A-Za-z0-9_-]{20,}'
PATTERNS="$PATTERNS"'|-----BEGIN [A-Z ]*PRIVATE KEY-----'

case "$MODE" in
  # Seules les lignes ajoutees comptent : une ligne supprimee ne part pas.
  --staged) CONTENT=$(git diff --cached -U0 | grep '^+' || true) ;;
  --range)  CONTENT=$(git diff -U0 "$FROM" "$TO" | grep '^+' || true) ;;
  *)        CONTENT=$(git grep -I --no-color -e '' -- . 2>/dev/null || true) ;;
esac

HITS=$(printf '%s' "$CONTENT" | grep -cE "$PATTERNS" || true)
if [ "${HITS:-0}" -gt 0 ]; then
  fail "$HITS ligne(s) portent ce qui ressemble a un jeton d'acces."
  printf '    Valeur volontairement non affichee.\n' >&2
  printf '    Pour la reperer : git diff --cached | grep -nE "sk-|ghp_|AKIA|BEGIN.*PRIVATE"\n' >&2
  FAILED=1
fi

# --- 3. gitleaks en supplement --------------------------------------------

if command -v gitleaks >/dev/null 2>&1; then
  case "$MODE" in
    --staged) gitleaks git --staged --no-banner --redact --log-level error . ;;
    --range)  gitleaks git --no-banner --redact --log-level error --log-opts "$FROM..$TO" . ;;
    *)        gitleaks git --no-banner --redact --log-level error . ;;
  esac
  if [ $? -ne 0 ]; then
    fail "gitleaks a trouve un secret (valeur masquee ci-dessus)."
    printf '    Faux positif : ajoutez le commentaire gitleaks:allow sur la ligne.\n' >&2
    FAILED=1
  fi
else
  printf '%s gitleaks absent : seuls les motifs de prefixe sont verifies.\n' \
    "${YEL}Attention${OFF}" >&2
  printf '    Installez-le : https://github.com/gitleaks/gitleaks\n' >&2
fi

if [ "$FAILED" -ne 0 ]; then
  printf '\n  Rien n%s a ete enregistre.\n' "'" >&2
  exit 1
fi

printf '%s aucun secret detecte\n' "${GRN}ok${OFF}" >&2
exit 0
