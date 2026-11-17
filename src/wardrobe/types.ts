export const T = {
  shirt:'Футболка', hoodie:'Толстовка с капюшоном', jacket:'Куртка', pants:'Брюки', joggers:'Джоггеры', puffed:'Дутые штаны',
  dress:'Платье', bracers:'Нарукавники', gloves:'Перчатки', boots:'Сапоги', armor:'Доспех'
} as const
export type GarmentType=keyof typeof T
