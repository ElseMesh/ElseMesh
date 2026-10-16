#!/usr/bin/env bash
set -euo pipefail

# Fetch all branches from `loz` and publish their current trees under
# loz/<branch> on origin. Rewritten histories are retained under
# archive/loz-preserved/<branch>/<old-mirror-sha>.

repo_root=$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)
cd "$repo_root"

die() {
	printf 'mirror-loz: %s\n' "$*" >&2
	exit 1
}

git remote get-url loz >/dev/null 2>&1 || die "remote 'loz' is not configured"
git remote get-url origin >/dev/null 2>&1 || die "remote 'origin' is not configured"

# Keep the old source tips long enough to detect a rewrite on the first sync.
declare -A prior_source=()
while IFS=' ' read -r branch sha; do
	[[ -n "$branch" ]] && prior_source["$branch"]=$sha
done < <(git for-each-ref --format='%(refname:strip=3) %(objectname)' refs/remotes/loz/)

git fetch --prune loz || die "fetch from 'loz' failed"
git fetch --prune origin || die "fetch from 'origin' failed"

declare -A source_branches=()
while IFS= read -r branch; do
	[[ -n "$branch" ]] && source_branches["$branch"]=1
done < <(git for-each-ref --format='%(refname:strip=3)' refs/remotes/loz/)

declare -A active_branches=()
while IFS= read -r branch; do
	[[ -n "$branch" ]] && active_branches["$branch"]=1
done < <(git for-each-ref --format='%(refname:strip=4)' refs/remotes/origin/loz/)

refspecs=()
updated=0
preserved=0
deleted=0
unchanged=0

preserve_ref() {
	local branch=$1 sha=$2
	local destination="refs/heads/archive/loz-preserved/$branch/$sha"
	local existing
	existing=$(git ls-remote --heads origin "$destination" | awk 'NR == 1 {print $1}')
	if [[ -n "$existing" && "$existing" != "$sha" ]]; then
		die "preservation ref collision at $destination"
	fi
	if [[ "$existing" != "$sha" ]]; then
		refspecs+=("$sha:$destination")
		((preserved += 1))
	fi
}

mirror_branch() {
	local branch=$1 source_ref="refs/remotes/loz/$1"
	local remote_active_ref="refs/remotes/origin/loz/$1"
	local source_sha active_sha previous_source legacy_ref legacy_sha tree new_sha message
	source_sha=$(git rev-parse "$source_ref")
	active_sha=''
	if git show-ref --verify --quiet "$remote_active_ref"; then
		active_sha=$(git rev-parse "$remote_active_ref")
	fi

	if [[ -n "$active_sha" ]]; then
		previous_source=$(git show -s --format=%B "$active_sha" | sed -n 's/^Loz-Mirror-Source: //p' | tail -n 1)
		[[ -n "$previous_source" ]] || previous_source=$active_sha
		if [[ "$source_sha" == "$previous_source" ]]; then
			printf 'unchanged %s (%s)\n' "$branch" "${source_sha:0:12}"
			((unchanged += 1))
			return
		fi
		if ! git merge-base --is-ancestor "$previous_source" "$source_sha"; then
			preserve_ref "$branch" "$active_sha"
			printf 'rewritten %s; preserved %s\n' "$branch" "${active_sha:0:12}"
		fi
		tree=$(git rev-parse "$source_sha^{tree}")
		message=$(printf 'Mirror Loz branch %s\n\nLoz-Mirror-Source: %s\n' "$branch" "$source_sha")
		new_sha=$(printf '%s\n' "$message" | GIT_AUTHOR_NAME='Loz mirror' GIT_AUTHOR_EMAIL='loz-mirror@users.noreply.github.com' GIT_COMMITTER_NAME='Loz mirror' GIT_COMMITTER_EMAIL='loz-mirror@users.noreply.github.com' git commit-tree "$tree" -p "$active_sha" -p "$source_sha")
	else
		legacy_ref="refs/remotes/origin/archive/loz/$branch"
		legacy_sha=''
		if git show-ref --verify --quiet "$legacy_ref"; then
			legacy_sha=$(git rev-parse "$legacy_ref")
			preserve_ref "$branch" "$legacy_sha"
		fi
		if [[ -n "${prior_source[$branch]:-}" ]] && ! git merge-base --is-ancestor "${prior_source[$branch]}" "$source_sha"; then
			if [[ -n "$legacy_sha" ]]; then
				printf 'rewritten %s on initial sync; preserved legacy copy %s\n' "$branch" "${legacy_sha:0:12}"
			fi
		fi
		if [[ -n "$legacy_sha" ]]; then
			tree=$(git rev-parse "$source_sha^{tree}")
			message=$(printf 'Mirror Loz branch %s\n\nLoz-Mirror-Source: %s\n' "$branch" "$source_sha")
			new_sha=$(printf '%s\n' "$message" | GIT_AUTHOR_NAME='Loz mirror' GIT_AUTHOR_EMAIL='loz-mirror@users.noreply.github.com' GIT_COMMITTER_NAME='Loz mirror' GIT_COMMITTER_EMAIL='loz-mirror@users.noreply.github.com' git commit-tree "$tree" -p "$legacy_sha" -p "$source_sha")
		else
			new_sha=$source_sha
		fi
	fi

	refspecs+=("$new_sha:refs/heads/loz/$branch")
	printf 'publish %s (%s)\n' "$branch" "${source_sha:0:12}"
	((updated += 1))
}

for branch in "${!source_branches[@]}"; do
	mirror_branch "$branch"
done

# A missing branch after a successful fetch is a deletion. Preserve its last
# published commit and remove the active mirror ref in the same atomic push.
for branch in "${!active_branches[@]}"; do
	if [[ -z "${source_branches[$branch]:-}" ]]; then
		active_sha=$(git rev-parse "refs/remotes/origin/loz/$branch")
		preserve_ref "$branch" "$active_sha"
		refspecs+=(":refs/heads/loz/$branch")
		printf 'deleted %s; preserved %s\n' "$branch" "${active_sha:0:12}"
		((deleted += 1))
	fi
done

if ((${#refspecs[@]})); then
	git push --atomic origin "${refspecs[@]}" || die "atomic publication failed; remote refs were not changed"
fi

printf 'mirror-loz: %d published, %d preserved, %d deleted, %d unchanged\n' \
	"$updated" "$preserved" "$deleted" "$unchanged"
