import { Injectable } from '@angular/core';
import { Http } from '@capacitor-community/http';
// @ts-ignore
import * as sha1 from 'js-sha1';
// @ts-ignore
import {Device} from "@capacitor/device";

export class Folder {
  folderID: string | undefined;
  folderName: string | undefined;
}

export class File {
  fileName: string | undefined;
  fileMetaID: string | undefined;
}

export class DataRoomRequest {
  command: string;
  mobile_id: string | undefined | null = null;
  parameter: {[key: string]: string};
  resultName: string;

  constructor(command: string, parameter: {[key: string]: string}, resultName: string) {
    this.command = command;
    this.parameter = parameter;
    this.resultName = resultName;
  }
}


@Injectable({
  providedIn: 'root',
})
export class DataRoomsService {
  public deviceId: string | undefined;
  public sessionID: string | undefined;
  public sessionExpires: Date | undefined;
  public roomID: string | undefined;
  public rootFolderID: string | undefined;
  public folders: Folder[] | undefined;

  private baseUrl = 'https://dr.gazprom-neft.ru/DataRoomsExt/hs/extapi/';
  private isInit = false;

  public async init(userName: string, password: string): Promise<void> {
    this.deviceId = (await Device.getId()).uuid;
    const session = localStorage.getItem('DataRoomSession');
    if (!session) {
      console.log(
        '[DataRoomsService] Не найдено сохраненной сессии, авторизую заново'
      );
      await this.authorize(userName, password);
    } else {
      console.log(
        '[DataRoomsService] Обнаружены сохраненные данные сессии'
      );
    }
    let sessionObject = JSON.parse(
      <string>localStorage.getItem('DataRoomSession')
    );
    if (!sessionObject) {
      console.log('[DataRoomsService] Комната данных недоступна!');
      this.isInit = false;
    } else {
      const now = new Date();
      const d = new Date(sessionObject.sessionExpires);
      console.log('[DataRoomsService] Текущее время');
      console.log(now);
      console.log('[DataRoomsService] Срок сессии');
      console.log(d);
      const diff = d.getTime() + 3 * 3600000 - now.getTime();
      console.log('[DataRoomsService] Разница во времени');
      console.log(diff);
      if (diff < 0) {
        console.log('[DataRoomsService] Необходимо обновить сессию');
        await this.authorize(userName, password);
      }
      sessionObject = JSON.parse(
        <string>localStorage.getItem('DataRoomSession')
      );
      if (!sessionObject) {
        console.log('[DataRoomsService] Комната данных недоступна!');
        this.isInit = false;
      } else {
        this.sessionID = sessionObject.sessionID;
        this.sessionExpires = sessionObject.sessionExpires;
        console.log(this.sessionID);
        console.log(this.sessionExpires);
        this.isInit = true;
        console.log('[DataRoomsService] Сессия готова!');

        await this.getDataRooms();
        await this.getFolders();
        console.log('Папки:');
        console.log(this.folders);
        // @ts-ignore
        const tasksFolderId = this.folders.find(
          (x) => x.folderName === 'Tasks'
        ).folderID;
        console.log(tasksFolderId);
      }
    }
  }

  public async sendRequest(request: DataRoomRequest): Promise<any> {
    try {
      request.mobile_id = this.deviceId;
      const date = new Date();
      const dateString = date.getFullYear() + ("0" + (date.getMonth() + 1)).slice(-2) + ("0" + date.getDate()).slice(-2) + "T" + ("0" + date.getHours()).slice(-2) + ("0" + date.getMinutes()).slice(-2) + ("0" + date.getSeconds()).slice(-2) + "Z";
      const deviceId = await Device.getId();
      const fileName = `getAuth_${dateString}_${deviceId.uuid}.json`;
      console.log("[DataRoomsService] Запрос:");
      console.log(JSON.stringify(request));
      const requestFileMetaId = await this.uploadFile('36d71d55-a137-11ec-a2fd-00505692ec6e', fileName,
        `${JSON.stringify(request)}`);
      let completed = false;
      let connectionCount = 0;
      while (!completed && connectionCount < 10) {
        await this.delay(8000);
        const results = await this.getFiles("3de658cb-a137-11ec-a2fd-00505692ec6e");
        // @ts-ignore
        const trueResult = results.find(x => x.fileName.startsWith(request.resultName) && x.fileName.replace(".json", "").endsWith(this.deviceId));
        if (trueResult) {
          completed = true;
          console.log(trueResult.fileName);
          //  await this.deleteFile(requestFileMetaId);
          const result = await this.getFile(trueResult.fileMetaID);
          //  await this.deleteFile(trueResult.fileMetaID);
          console.log("[DataRoomsService] Запрос выполнен успешно");
          return result;
        }
        connectionCount++;
      }
      console.log("[DataRoomsService] Запрос выполнен с превышением максимального количества запросов");
      return await Promise.reject();
    }
    catch {
      await Promise.reject();
    }
  }

  public async getFiles(folderId: string): Promise<File[]> {
    const options = {
      url: `${this.baseUrl}content?sessionID=${this.sessionID}&roomID=${this.roomID}&folderID=${folderId}`,
    };
    const response = await Http.get(options);
    console.log('[DataRoomsService] Запрос содержимого папки КД');
    console.log(response.status);
    console.log(response.data);

    if (response.status === 200) {
      return (JSON.parse(response.data).contentData) as File[];
    }
    else {
      return JSON.parse("[]") as File[];
    }
  }

  public async deleteFile(fileMetaID: string): Promise<void> {
    const options = {
      // eslint-disable-next-line max-len
      url: `${this.baseUrl}delete?sessionID=${this.sessionID}&fileMetaID=${fileMetaID}`,
    };
    const response = await Http.post(options);
    if (response.status === 200) {
      console.log(
        `[DataRoomsService] Удален файл по метаданным ${fileMetaID}`
      );
      console.log(response.status);
      console.log(response.data);
    } else {
      console.log(
        `[DataRoomsService] Ошибка удаления файла по метаданным ${fileMetaID}`
      );
    }
  }

  public async uploadFile(
    folderId: string,
    fileName: string,
    fileBody: string
  ): Promise<string> {
    const fileSize = fileBody.length;
    const fileMetaID = await this.createFileMetadata(
      folderId,
      fileName,
      fileSize
    );
    await this.uploadFileContent(fileMetaID, fileName, fileBody);
    return fileMetaID;
  }

  public async getFile(fileMetaID: string | undefined): Promise<any> {
    const options = {
      url: `${this.baseUrl}download?sessionID=${this.sessionID}&fileMetaID=${fileMetaID}`,
    };
    const response = await Http.get(options);
    if (response.status === 200) {
      console.log(
        `[DataRoomsService] Загрузка содержимого файла по метаданным ${fileMetaID}`
      );
      console.log(response.status);
      console.log(response.data);
      return JSON.parse(response.data);
    } else {
      console.log(
        `[DataRoomsService] ОШИБКА при получении файла с метаданными ${fileMetaID}`
      );
      return null;
    }
  }

  private async delay(ms: number) {
    return new Promise( resolve => setTimeout(resolve, ms) );
  }

  private async authorize(userName: string, password: string): Promise<void> {
    const options = {
      url: `${this.baseUrl}login`,
      headers: { 'Content-Type': 'text/plain' },
      data: `login=${userName}&password=${password}`,
    };

    const response = await Http.post(options);
    if (response.status === 200) {
      console.log(
        '[DataRoomsService] Открыта новая сессия комнаты данных'
      );

      this.sessionID = response.data.sessionId;
      this.sessionExpires = new Date(response.data.sessionExpires);

      localStorage.setItem('DataRoomSessionId', response.data.sessionID);
      localStorage.setItem(
        'DataRoomSessionExpires',
        response.data.sessionExpires
      );
      localStorage.setItem('DataRoomSession', response.data);
      console.log(response.data.sessionId);
      console.log(response.data.sessionExpires);
      console.log(response.data);
      console.log(
        '[DataRoomsService] Данные сохранены в локальном хранилище'
      );
    } else {
      console.log('[DataRoomsService] Ошибка авторизации');
      console.log(response.status);
      console.log(response.data);
    }
  }

  private async getDataRooms(): Promise<void> {
    const options = {
      url: `${this.baseUrl}datarooms?sessionID=${this.sessionID}`,
    };
    const response = await Http.get(options);
    if (response.status === 200) {
      console.log('[DataRoomsService] Получен список комнат данных');
      console.log(response.status);
      console.log(response.data);

      const responseObject = JSON.parse(response.data);
      this.rootFolderID = responseObject[0].rootFolderID;
      this.roomID = responseObject[0].roomID;

      console.log('ID комнаты данных');
      console.log(this.roomID);
      console.log('ID корневой папки');
      console.log(this.rootFolderID);
    } else {
      console.log(
        '[DataRoomsService] ОШИБКА получения списка комнат данных'
      );
    }
  }

  private async getFolders(): Promise<void> {
    const options = {
      url: `${this.baseUrl}childfolder?sessionID=${this.sessionID}&folderID=${this.rootFolderID}`,
    };
    // @ts-ignore
    const response = await Http.get(options);
    console.log(response.status);
    console.log(response.data);
    if (response.status === 200) {
      console.log('[DataRoomsService] Получены дочерние папки КД');
      this.folders = JSON.parse(response.data);
      console.log(this.folders);
    } else {
      console.log(
        '[DataRoomsService] ОШИБКА получения дочерних папок КД'
      );
    }
  }

  private async createFileMetadata(
    folderId: string,
    fileName: string,
    fileSize: number
  ): Promise<string> {
    const options = {
      // eslint-disable-next-line max-len
      url: `${this.baseUrl}upload?sessionID=${
        this.sessionID
      }&chunkNumber=0&roomID=${this.roomID}&fileID=${
        folderId + '_' + fileName + '_' + fileSize
      }&fileName=${fileName}&totalChunks=1&totalSize=${fileSize}&fileDesc=${fileName}&folderID=${folderId}`,
    };
    const response = await Http.post(options);
    console.log(response.status);
    console.log(response.data);
    if (response.status === 200) {
      console.log(
        `[DataRoomsService] Созданы метаданные для файла ${fileName}`
      );
    } else {
      console.log(
        `[DataRoomsService] ОШИБКА при создании метаданных для файла ${fileName}`
      );
    }
    const responseObject = JSON.parse(response.data);
    return responseObject.fileMetaID;
  }

  private async uploadFileContent(
    fileMetaID: string,
    fileName: string,
    fileBody: string
  ): Promise<void> {
    console.log('SHA1:');
    console.log(sha1(fileBody));

    const options = {
      // eslint-disable-next-line max-len
      url: `${this.baseUrl}upload?sessionID=${
        this.sessionID
      }&chunkNumber=1&roomID=${
        this.roomID
      }&fileMetaID=${fileMetaID}&chunkHash=${sha1(
        fileBody
      )}&timestamp=${new Date().getTime()}`,
      headers: { 'Content-Type': 'text/plain' },
      // eslint-disable-next-line max-len
      data: `------WebKitFormBoundaryYLjBDkbDdX4dY2ks\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n${fileBody}\r\n------WebKitFormBoundaryYLjBDkbDdX4dY2ks--`,
    };

    const response = await Http.post(options);
    console.log(response.status);
    console.log(response.data);
    if (response.status === 200) {
      console.log(`[DataRoomsService] Загружен файл ${fileName}`);
    } else {
      console.log(`[DataRoomsService] ОШИБКА загрузки файла ${fileName}`);
    }
  }
}
