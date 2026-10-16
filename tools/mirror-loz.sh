#!/usr/bin/env bash
set -euo pipefail

# Fetch all branches from `loz` and publish exact source tips under
# loz/<branch> on origin. Replaced and deleted tips are retained under
# archive/loz-preserved/<branch>/<old-sha>.

repo_root=$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)
cd "$repo_root"

die() {
	printf 'mirror-loz: %s\n' "$*" >&2
	exit 1
}

git remote get-url loz >/dev/null 2>&1 || die "remote 'loz' is not configured"
git remote get-url origin >/dev/null 2>&1 || die "remote 'origin' is not configured"

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

rename_refspecs=()
publish_refspecs=()
published=0
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
		rename_refspecs+=("$sha:$destination")
		((preserved += 1))
	fi
}

for branch in "${!source_branches[@]}"; do
	source_sha=$(git rev-parse "refs/remotes/loz/$branch")
	active_ref="refs/heads/loz/$branch"
	remote_active_ref="refs/remotes/origin/loz/$branch"
	active_sha=''
	if git show-ref --verify --quiet "$remote_active_ref"; then
		active_sha=$(git rev-parse "$remote_active_ref")
	fi

	if [[ -z "$active_sha" ]]; then
		# Preserve the pre-mirror archive on first sync, then create the active
		# branch directly at the source commit.
		legacy_ref="refs/remotes/origin/archive/loz/$branch"
		if git show-ref --verify --quiet "$legacy_ref"; then
			preserve_ref "$branch" "$(git rev-parse "$legacy_ref")"
		fi
		publish_refspecs+=("$source_sha:$active_ref")
		printf 'publish %s at exact source tip %s\n' "$branch" "${source_sha:0:12}"
		((published += 1))
	elif [[ "$active_sha" == "$source_sha" ]]; then
		printf 'unchanged %s (%s)\n' "$branch" "${source_sha:0:12}"
		((unchanged += 1))
	elif git merge-base --is-ancestor "$active_sha" "$source_sha"; then
		# A normal fast-forward keeps the active ref exactly on Loz's commit.
		publish_refspecs+=("$source_sha:$active_ref")
		printf 'advance %s to exact source tip %s\n' "$branch" "${source_sha:0:12}"
		((published += 1))
	else
		# Preserve and remove the old name first. A subsequent ordinary push
		# creates loz/<branch> anew at the exact source commit, without force.
		preserve_ref "$branch" "$active_sha"
		rename_refspecs+=(":$active_ref")
		publish_refspecs+=("$source_sha:$active_ref")
		printf 'rewrite %s: preserve %s, then publish exact tip %s\n' \
			"$branch" "${active_sha:0:12}" "${source_sha:0:12}"
		((published += 1))
	fi
done

# Deleted upstream branches are retained before their active mirror refs go.
for branch in "${!active_branches[@]}"; do
	if [[ -z "${source_branches[$branch]:-}" ]]; then
		active_sha=$(git rev-parse "refs/remotes/origin/loz/$branch")
		preserve_ref "$branch" "$active_sha"
		rename_refspecs+=(":refs/heads/loz/$branch")
		printf 'deleted %s; preserved %s\n' "$branch" "${active_sha:0:12}"
		((deleted += 1))
	fi
done

# Preserve and remove refs atomically. If the next push is interrupted, rerun
# sees the missing active ref and recreates it directly from the source tip.
if ((${#rename_refspecs[@]})); then
	git push --atomic origin "${rename_refspecs[@]}" || die "preservation/rename push failed; remote refs were not changed"
fi
if ((${#publish_refspecs[@]})); then
	git push --atomic origin "${publish_refspecs[@]}" || die "publication failed; rerun to complete any pending mirror creation"
fi

printf 'mirror-loz: %d published, %d preserved, %d deleted, %d unchanged\n' \
	"$published" "$preserved" "$deleted" "$unchanged"
