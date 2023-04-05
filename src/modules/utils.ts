
import PDF from "E:/Github/zotero-reference/src/modules/pdf"
import { config } from "../../package.json";

export default class Utils {
  private cache: any = {}
  constructor() {
  }

  /**
   * 获取PDF页面文字
   * @returns 
   */
  public getPDFSelection() {
    try {
      return ztoolkit.Reader.getSelectedText(
        Zotero.Reader.getByTabID(Zotero_Tabs.selectedID)
      );
    } catch {
      return ""
    }
  }

  /**
   * 获取选中条目某个字段
   * @param fieldName 
   * @returns 
   */
  public getItemField(fieldName: any) {
    return ZoteroPane.getSelectedItems()[0].getField(fieldName)
  }

  public async uploadPDF() {    
    let attachmentPath = Zotero.Items.get(
      Zotero.Reader.getByTabID(Zotero_Tabs.selectedID)!.itemID as number
    ).attachmentPath
    const formData = new window.FormData();
    formData.append("files", new window.File([attachmentPath], "test.pdf", { type: "application/pdf"})); // 假设file是一个File对象，表示要上传的文件

    window.fetch("http://127.0.0.1:7860/upload", {
      method: "POST",
      body: formData
    })
      .then(response => {
        if (response.ok) {
          console.log("上传成功！");
        } else {
          console.error("上传失败，状态码为：" + response.status);
        }
      })
      .catch(error => console.error("上传失败，错误信息为：" + error));
  }

  public async getRelatedText(host: string, queryText: string) {
    let pdfItem = Zotero.Items.get(
      Zotero.Reader.getByTabID(Zotero_Tabs.selectedID)!.itemID as number
    )
    // let attachmentPath = pdfItem.attachmentPath
    // if (attachmentPath.startsWith("storage:")) {
    //   attachmentPath = attachmentPath.replace(/^storage:/, `E:/Zotero/storage/${pdfItem.key}/`)
    // }
    const xhr = await Zotero.HTTP.request(
      "POST",
      `http://${host}/getRelatedText`,
      {
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          queryText,
          id: pdfItem.key,
          fullText: await this.readPDFFullText(pdfItem.key, true)
        }),
        responseType: "json"
      }
    );
    let text = ""
    for (let i = 0; i < xhr.response.length; i++) {
      let refText = xhr.response[i]
      // 寻找坐标
      // const box = this.cache[pdfItem.key].find((i: any)=>i.text.indexOf(refText) != -1).box
      // text += `[${i + 1}] ${JSON.stringify(box)}\n${refText}`
      text += `[${i + 1}] ${refText}`
      if (i < xhr.response.length - 1) {
        text += "\n\n"
      }
    }
    return text.slice(0, 3000)
  }

  /**
   * await Zotero.ZoteroGPT.utils.readPDFFullText()
   */
  public async readPDFFullText(itemkey: string, force: boolean = false) {
    // @ts-ignore
    const OS = window.OS;
    const temp = Zotero.getTempDirectory()
    const filename = OS.Path.join(temp.path.replace(temp.leafName, ""), `${config.addonRef}-${itemkey}.json`);
    if (!force && await OS.File.exists(filename)) {
      return await Zotero.File.getContentsAsync(filename) as string
    }
    const reader = await ztoolkit.Reader.getReader() as _ZoteroTypes.ReaderInstance
    const PDFViewerApplication = (reader._iframeWindow as any).wrappedJSObject.PDFViewerApplication;
    await PDFViewerApplication.pdfLoadingTask.promise;
    await PDFViewerApplication.pdfViewer.pagesPromise;
    let pages = PDFViewerApplication.pdfViewer._pages;
    const PDFInstance = new PDF()
    let totalPageNum = pages.length
    const popupWin = new ztoolkit.ProgressWindow("[Pending] PDF", {closeTime: -1, closeOtherProgressWindows: true})
      .createLine({ text: `[1/${totalPageNum}] Reading`, progress: 1, type: "success"})
      .show()
    // 读取所有页面lines
    const pageLines: any = {}
    for (let pageNum = 0; pageNum < totalPageNum; pageNum++) {
      let pdfPage = pages[pageNum].pdfPage

      let textContent = await pdfPage.getTextContent()
      let items: PDFItem[] = textContent.items.filter((item: PDFItem) => item.str.trim().length)
      let index = items.findIndex(item => /(r?eferences?|acknowledgements)$/i.test(item.str))
      items = items.slice(0, index)
      pageLines[pageNum] = PDFInstance.mergeSameLine(items)
      popupWin.changeLine({ text: `[${pageNum+1}/${totalPageNum}] Reading`, progress: (pageNum+1) / totalPageNum * 100 })
      if (index != -1) {
        break
      }
    }
    console.log(pageLines)
    popupWin.changeHeadline("[Pending] PDF");
    popupWin.changeLine({ progress: 100 });
    const pageParagraphs: any = {}
    totalPageNum = Object.keys(pageLines).length
    for (let pageNum = 0; pageNum < totalPageNum; pageNum++) {
      let pdfPage = pages[pageNum].pdfPage
      const maxWidth = pdfPage._pageInfo.view[2];
      const maxHeight = pdfPage._pageInfo.view[3];
      let lines = [...pageLines[pageNum]]
      // 去除页眉页脚信息
      let removeLines = new Set()
      let removeNumber = (text: string) => {
        // 英文页码
        if (/^[A-Z]{1,3}$/.test(text)) {
          text = ""
        }
        // 正常页码1,2,3
        text = text.replace(/\s+/g, "").replace(/\d+/g, "")
        return text
      }
      // 是否跨页同位置
      let isIntersectLines = (lineA: any, lineB: any) => {
        let rectA = {
          left: lineA.x / maxWidth,
          right: (lineA.x + lineA.width) / maxWidth,
          bottom: lineA.y / maxHeight,
          top: (lineA.y + lineA.height) / maxHeight
        }
        let rectB = {
          left: lineB.x / maxWidth,
          right: (lineB.x + lineB.width) / maxWidth,
          bottom: lineB.y / maxHeight,
          top: (lineB.y + lineB.height) / maxHeight
        }
        return PDFInstance.isIntersect(rectA, rectB)
      }
      // 是否为重复
      let isRepeat = (line: PDFLine, _line: PDFLine) => {
        let text = removeNumber(line.text)
        let _text = removeNumber(_line.text)
        return text == _text && isIntersectLines(line, _line)
      }
      // 存在于数据起始结尾的无效行
      for (let i of Object.keys(pageLines)) {
        if (Number(i) == pageNum) { continue }
        // 两个不同页，开始对比
        let _lines = pageLines[i]
        let directions = {
          forward: {
            factor: 1,
            done: false
          },
          backward: {
            factor: -1,
            done: false
          }
        }
        for (let offset = 0; offset < lines.length && offset < _lines.length; offset++) {
          ["forward", "backward"].forEach((direction: string) => {
            if (directions[direction as keyof typeof directions].done) { return }
            let factor = directions[direction as keyof typeof directions].factor
            let index = factor * offset + (factor > 0 ? 0 : -1)
            let line = lines.slice(index)[0]
            let _line = _lines.slice(index)[0]
            if (isRepeat(line, _line)) {
              // 认为是相同的
              line[direction] = true
              removeLines.add(line)
            } else {
              directions[direction as keyof typeof directions].done = true
            }
          })
        }
        // 内部的
        // 设定一个百分百正文区域防止误杀
        const content = { x: 0.2 * maxWidth, width: .6 * maxWidth, y: .2 * maxHeight, height: .6 * maxHeight }
        for (let j = 0; j < lines.length; j++) {
          let line = lines[j]
          if (isIntersectLines(content, line)) { continue }
          for (let k = 0; k < _lines.length; k++) {
            let _line = _lines[k]
            if (isRepeat(line, _line)) {
              line.repeat = line.repeat == undefined ? 1 : (line.repeat + 1)
              line.repateWith = _line
              removeLines.add(line)
            }
          }
        }  
      }
      lines = lines.filter((e: any) => !(e.forward || e.backward || (e.repeat && e.repeat > 3)));
      // 合并同段落
      // 原则：字体从大到小，合并；从小变大，断开
      let abs = (x: number) => x > 0 ? x: -x
      const paragraphs = [[lines[0]]]
      for (let i = 1; i < lines.length; i++) {
        let lastLine = paragraphs.slice(-1)[0].slice(-1)[0]
        let currentLine = lines[i]
        const isNewParagraph =
          currentLine._height.every((h2: number) => lastLine._height.every((h1: number) => h2 > h1)) ||
          /abstract/i.test(currentLine.text) ||
          abs(lastLine.y - currentLine.y) > currentLine.height * 2 ||
          currentLine.x > lastLine.x

        // 开新段落
        if (isNewParagraph) {
          paragraphs.push([currentLine])
        }
        // 否则纳入当前段落
        else {
          paragraphs.slice(-1)[0].push(currentLine)
        }
      }
      // 段落合并
      let ptextArr = []
      for (let i = 0; i < paragraphs.length; i++) {
        let box: { page: number, left: number; top: number; right: number; bottom: number }
        let ltextArr = []
        for (let line of paragraphs[i]) {
          ltextArr.push(line.text)
          box ??= { page: pageNum, left: line.x, right: line.x + line.width, top: line.y + line.height, bottom: line.y }
          if (line.x < box.left) {
            box.left = line.x
          }
          if (line.x + line.width > box.right) {
            box.right = line.x + line.width
          }
          if (line.y < box.bottom) {
            line.y = box.bottom
          }
          if (line.y + line.height > box.top) {
            box.top = line.y + line.height
          }
        }
        // 储存用于确定位置
        this.cache[itemkey] ??= []
        const ptext = ltextArr.join(" ")
        this.cache[itemkey].push({
          box: box!,
          text: ptext
        })
        ptextArr.push(ptext)
      }
      pageParagraphs[pageNum] = ptextArr.join("\n\n")
    }
    popupWin.startCloseTimer(1000)
    const fullText = Object.values(pageParagraphs).join("\n\n")
    await Zotero.File.putContentsAsync(filename, fullText);
    return fullText
  }
}