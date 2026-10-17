export const modifierIds = item => [...new Set(item.modifier_option_ids || [])].sort()
export const cartKey = item => JSON.stringify([item.variant_id, modifierIds(item)])
export function recipeSelection(variant, ids = []) {
  const selected = [...new Set(ids)], groups = variant?.recipe?.modifier_groups || []
  const options = groups.flatMap(group => group.options.filter(option => selected.includes(option.id)).map(option => ({...option,group_name:group.name})))
  const valid = options.length === selected.length && groups.every(group => {
    const count = group.options.filter(option => selected.includes(option.id)).length
    return count >= Math.max(group.required ? 1 : 0, group.min_select) && count <= group.max_select
  })
  return {valid,options,price:Math.max(0,Number(variant?.price || 0)+options.reduce((sum,option)=>sum+option.price_delta,0))}
}
