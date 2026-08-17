async function addPaperToLibrary(client, userId, paperId) {
  const { error } = await client
    .from('user_library')
    .insert({ user_id: userId, paper_pmid: paperId });

  // The compound key makes this operation naturally idempotent. A duplicate
  // means the paper is already saved and does not require UPDATE permission.
  if (error && error.code !== '23505') throw error;
}

module.exports = { addPaperToLibrary };
